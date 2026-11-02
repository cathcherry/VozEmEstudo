"""Authorized synthetic staging only; independent PostgreSQL sessions, no migrations."""

import configparser
import json
import os
import selectors
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXISTING_PROJECT_REF = "fxsuagrcfargpejglwtl"


def require(condition):
    if not condition:
        raise ValueError("Staging prerequisite missing or invalid")


def private_file(filename):
    path = Path(filename).resolve()
    require(path.is_file() and not path.is_relative_to(ROOT))
    if os.name != "nt":
        require(path.stat().st_mode & 0o077 == 0)
    return path


def validate_settings(source):
    for name in ["E02_STAGING_WRITES_APPROVED", "E02_SYNTHETIC_ONLY", "E02_WORKERS_PAUSED"]:
        require(source.get(name) == "true")
    ref = source.get("E02_STAGING_PROJECT_REF", "")
    require(len(ref) == 20 and ref.isascii() and ref.isalnum() and ref.islower())
    require(ref != EXISTING_PROJECT_REF)
    service_name = source.get("E02_PGSERVICE", "")
    require(service_name == "e02_staging")
    if os.name == "nt":
        require(source.get("E02_PRIVATE_FILES_CONFIRMED") == "true")
    service_file = private_file(source.get("PGSERVICEFILE", ""))
    parser = configparser.ConfigParser(interpolation=None)
    parser.read(service_file)
    require(parser.has_section(service_name))
    service = parser[service_name]
    require(
        set(service)
        <= {
            "host",
            "port",
            "dbname",
            "user",
            "password",
            "sslmode",
            "sslrootcert",
            "connect_timeout",
        }
    )
    host, user = service.get("host", ""), service.get("user", "")
    direct = host == f"db.{ref}.supabase.co" and user == "postgres"
    pooler = host.endswith(".pooler.supabase.com") and user == f"postgres.{ref}"
    require(direct or pooler)
    require(service.get("port") == "5432")  # Session pooler, never transaction mode 6543.
    require(service.get("dbname") == "postgres")
    require(service.get("sslmode") in {"require", "verify-full"})
    require(service.get("connect_timeout") == "10")
    manifest_path = private_file(source.get("E02_FIXTURE_FILE", ""))
    manifest = json.loads(manifest_path.read_text())
    require(manifest.get("syntheticOnly") is True and manifest.get("projectRef") == ref)
    require(manifest.get("permissionVersion", "").startswith("permission-v1:"))
    fixtures = manifest.get("fixtures", [])
    require(len(fixtures) == 2 and {item.get("label") for item in fixtures} == {"A", "B"})
    for item in fixtures:
        for name in ["userId", "materialId", "sourceRevisionId"]:
            require(str(uuid.UUID(item[name])) == item[name])
    require(len({item["userId"] for item in fixtures}) == 2)
    require(len({item["materialId"] for item in fixtures}) == 2)
    return service_file, manifest


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


class Session:
    def __init__(self, runner):
        self.process = subprocess.Popen(
            runner.command,
            env=runner.environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        try:
            self.send(
                "begin; set local lock_timeout='15s'; set local statement_timeout='20s'; select pg_backend_pid();"
            )
            self.pid = int(self.line())
        except Exception:
            self.close()
            raise

    def send(self, sql):
        self.process.stdin.write(sql + "\n")
        self.process.stdin.flush()

    def line(self):
        require(bool(self.selector.select(timeout=25)))
        line = self.process.stdout.readline().strip()
        require(bool(line))
        return line

    def close(self):
        self.selector.close()
        if self.process.poll() is None:
            self.process.terminate()  # An unfinished transaction is rolled back by disconnect.
        self.process.communicate(timeout=10)


class Runner:
    def __init__(self, service_file):
        require(shutil.which("psql") is not None)
        self.command = [
            "psql",
            "-X",
            "-q",
            "-A",
            "-t",
            "-v",
            "ON_ERROR_STOP=1",
            "-d",
            "service=e02_staging",
        ]
        # Ignore inherited PGHOST/PGPASSWORD/PGOPTIONS: use only the validated private service.
        self.environment = {
            key: value for key, value in os.environ.items() if not key.startswith("PG")
        }
        self.environment["PGSERVICEFILE"] = str(service_file)

    def sql(self, statement, expect_failure=False):
        result = subprocess.run(
            self.command,
            input=statement + "\n",
            env=self.environment,
            text=True,
            capture_output=True,
            timeout=30,
        )
        require((result.returncode != 0) if expect_failure else (result.returncode == 0))
        return result.stdout.strip()

    def contend(self, first_sql, second_sql):
        first = Session(self)
        second = None
        try:
            second = Session(self)
            require(first.pid != second.pid)
            first.send("set local role service_role; " + first_sql)
            first_id = first.line()
            second.send("set local role service_role; " + second_sql)
            deadline = time.monotonic() + 10
            blocked = False
            while time.monotonic() < deadline:
                blocking = self.sql(f"select {first.pid}=any(pg_blocking_pids({second.pid}));")
                if blocking == "t":
                    blocked = True
                    break
                time.sleep(0.1)
            require(blocked)  # Elapsed time alone is not evidence of lock contention.
            first.send("commit; select 'COMMITTED';")
            require(first.line() == "COMMITTED")
            second_id = second.line()
            second.send("commit; select 'COMMITTED';")
            require(second.line() == "COMMITTED")
            return first_id, second_id
        finally:
            first.close()
            if second is not None:
                second.close()


def main(source=None):
    service_file, manifest = validate_settings(os.environ if source is None else source)
    runner = Runner(service_file)
    require(
        runner.sql(
            "select current_setting('server_version_num')::integer between 170000 and 179999;"
        )
        == "t"
    )
    for fixture in manifest["fixtures"]:
        material_id = literal(fixture["materialId"])
        user_id = literal(fixture["userId"])
        source_id = literal(fixture["sourceRevisionId"])
        title = literal("E02 staging / " + fixture["label"])
        require(
            runner.sql(f"""select exists(select 1 from public.materials m
            join public.transcriptions t on t.material_id=m.id
            join public.transcription_versions v on v.transcription_id=t.id and v.revision=t.current_revision
            join public.transcription_confirmations c on c.transcription_version_id=v.id
            where m.id={material_id} and m.user_id={user_id} and v.id={source_id}
            and m.title={title}
            and c.user_id=m.user_id and c.consent_version=public.current_permission_version());""")
            == "t"
        )
    require(
        runner.sql(
            "select not exists(select 1 from public.processing_jobs where status='EM_EXECUCAO');"
        )
        == "t"
    )
    fixture = next(item for item in manifest["fixtures"] if item["label"] == "A")
    material_id, user_id, source_id = [
        literal(fixture[name]) for name in ["materialId", "userId", "sourceRevisionId"]
    ]
    results, jobs = [], []

    def enqueue(job_type, count=None, key=None):
        params = literal(json.dumps({"count": count} if count else {}))
        return f"select public.enqueue_processing_job_admin({user_id},{material_id},{literal(job_type)},{params}::jsonb,{source_id},{literal(key or uuid.uuid4())},public.current_permission_version(),3)->>'id';"

    def create_job(job_type, count=None):
        job_id = runner.sql(enqueue(job_type, count))
        require(str(uuid.UUID(job_id)) == job_id)
        jobs.append(job_id)
        return literal(job_id)

    def summary(job_id, model="fixture"):
        return f"select public.commit_summary_admin({material_id},{job_id},'Resumo fictício.',{literal(model) if model else 'null'},'concurrency-fixture')->>'id';"

    def batch(job_id, count, invalid=False):
        questions = [
            {
                "statement": f"Questão fictícia {index}?",
                "options": ["A", "B", "C", "D"],
                "correctIndex": 0,
                "explanation": "Fixture.",
            }
            for index in range(count)
        ]
        if invalid:
            questions[-1]["options"] = ["A", "B", "C"]
        return f"select public.commit_question_batch_admin({material_id},{job_id},{count},{literal(json.dumps(questions))}::jsonb,'fixture','concurrency-fixture')->>'id';"

    shared_key = str(uuid.uuid4())
    ids = runner.contend(
        enqueue("REGERAR_RESUMO", key=shared_key), enqueue("REGERAR_RESUMO", key=shared_key)
    )
    require(ids[0] == ids[1])
    jobs.append(ids[0])
    require(
        runner.sql(
            f"select count(*) from public.processing_jobs where material_id={material_id} and idempotency_key={literal(shared_key)};"
        )
        == "1"
    )
    results.append({"check": "enqueue-same-key-real-contention", "passed": True})
    first_job, second_job = create_job("REGERAR_RESUMO"), create_job("REGERAR_RESUMO")
    summaries = runner.contend(summary(first_job), summary(second_job))
    require(summaries[0] != summaries[1])
    require(
        runner.sql(
            f"select count(*) from public.summary_versions where material_id={material_id} and is_current;"
        )
        == "1"
    )
    require(runner.sql(summary(first_job)) == summaries[0])
    require(
        runner.sql(
            f"select count(*) from public.summary_versions where processing_job_id in ({first_job},{second_job});"
        )
        == "2"
    )
    results.append({"check": "summary-contention-one-current-and-retry", "passed": True})
    previous = runner.sql(
        f"select id from public.summary_versions where material_id={material_id} and is_current;"
    )
    rollback_job = create_job("REGERAR_RESUMO")
    runner.sql(summary(rollback_job, model=None), expect_failure=True)
    require(
        runner.sql(
            f"select id from public.summary_versions where material_id={material_id} and is_current;"
        )
        == previous
    )
    require(
        runner.sql(
            f"select count(*) from public.summary_versions where processing_job_id={rollback_job};"
        )
        == "0"
    )
    results.append({"check": "summary-rollback-after-current-update", "passed": True})
    first_batch, second_batch = create_job("GERAR_QUESTOES", 5), create_job("GERAR_QUESTOES", 5)
    batches = runner.contend(batch(first_batch, 5), batch(second_batch, 5))
    require(batches[0] != batches[1])
    require(runner.sql(batch(first_batch, 5)) == batches[0])
    for count in [3, 10, 20]:
        runner.sql(batch(create_job("GERAR_QUESTOES", count), count))
    bad_batch = create_job("GERAR_QUESTOES", 3)
    runner.sql(batch(bad_batch, 3, invalid=True), expect_failure=True)
    require(
        runner.sql(
            f"select count(*) from public.question_batches where processing_job_id={bad_batch};"
        )
        == "0"
    )
    require(
        runner.sql(
            f"select count(*) from public.question_batches b where b.material_id={material_id} and b.processing_job_id is not null and (b.generated_count<>b.requested_count or (select count(*) from public.questions q where q.batch_id=b.id)<>b.requested_count);"
        )
        == "0"
    )
    require(
        runner.sql(
            f"select count(*) from public.summary_versions where material_id={material_id} and processing_job_id is not null and source_transcription_version_id<>{source_id};"
        )
        == "0"
    )
    results.append({"check": "batches-3-5-10-20-contention-retry-and-rollback", "passed": True})
    print(
        json.dumps(
            {
                "executed": True,
                "passed": True,
                "checks": results,
                "independentWriterSessions": 2,
                "lockEvidence": "pg_blocking_pids; observer connections",
                "remoteWrites": True,
                "pending": [
                    "worker claim/retry races and edit while generating",
                    "fixtures remain; keep workers paused until reviewed",
                ],
                "syntheticJobsCreated": len(set(jobs)),
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(
            "Native staging suite blocked or failed. No connection values, SQL results or errors were logged. Keep workers paused and inspect synthetic fixtures.",
            file=sys.stderr,
        )
        sys.exit(1)
