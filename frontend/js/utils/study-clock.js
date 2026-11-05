export class StudyClock {
  constructor({api,materialId=null,uuid,now=()=>performance.now(),visible=()=>document.visibilityState==='visible'&&document.hasFocus(),onChange=()=>{}}) {
    Object.assign(this,{api,materialId,uuid,now,visible,onChange});
    this.mode='reading';this.remaining=1500;this.elapsed=0;this.running=false;
    this.session=null;this.sequence=0;this.pending=null;this.pendingStart=null;this.inFlight=null;this.busy=false;this.message='';
  }
  emit(message=this.message) { this.message=message;this.onChange(this); }
  async send(close,active) {
    if(this.inFlight) return this.inFlight;
    if(!this.session) return;
    if(!this.pending) this.pending={sequence:this.sequence+1,active,close};
    const wire={...this.pending},id=this.session.id;
    this.inFlight=(async()=>{
      try {
        const row=await this.api.tick(id,wire);
        this.sequence=row.last_sequence;this.pending=null;this.session=row.ended_at?null:row;
        if(row.ended_at&&!close) {this.running=false;this.emit('A sessão expirou ou foi encerrada. Inicie outra para continuar.');}
        return row;
      } catch(error) {this.running=false;this.emit(`${error.message||'Sem confirmação da sessão.'} O envio será reconciliado antes de iniciar outra sessão.`);throw error;}
      finally {this.inFlight=null;}
    })();
    return this.inFlight;
  }
  async reconcile() {
    if(this.pendingStart&&!this.session) {
      const row=await this.api.start(this.pendingStart);this.pendingStart=null;
      this.session=row.ended_at?null:row;this.sequence=row.last_sequence;
    }
    if(this.inFlight) await this.inFlight;
    if(this.pending) await this.send(this.pending.close,this.pending.active);
    if(this.session) await this.send(true,false);
  }
  async start(mode=this.mode) {
    if(this.running||this.busy) return;
    this.busy=true;this.emit('Iniciando…');
    try {
      await this.reconcile();
      if(mode!==this.mode) {this.mode=mode;this.elapsed=0;this.remaining=mode==='break'?300:1500;}
      if(!this.visible()) throw new Error('Mantenha esta aba visível e em foco para iniciar.');
      if(mode!=='break') {
        if(!this.pendingStart) this.pendingStart={sessionId:this.uuid(),materialId:this.materialId,kind:mode};
        const row=await this.api.start(this.pendingStart);this.pendingStart=null;
        if(row.ended_at) throw new Error('A sessão anterior já foi encerrada. Inicie uma nova sessão.');
        this.session=row;this.sequence=row.last_sequence;
      }
      this.running=true;this.lastNow=this.now();this.lastHeartbeat=this.lastNow;
      this.emit(mode==='break'?'Pausa iniciada; ela não soma tempo de estudo.':'Sessão em andamento. Sair da aba pausa a contagem.');
    } catch(error) {this.emit(error.message||'Não foi possível iniciar.');throw error;}
    finally {this.busy=false;this.emit();}
  }
  async pause(credit=this.visible()) {
    this.running=false;this.busy=true;this.emit('Pausando…');
    try {
      if(this.inFlight) await this.inFlight;
      if(this.pending) await this.send(this.pending.close,this.pending.active);
      if(this.session) await this.send(true,credit);
      this.emit('Sessão pausada. Retome quando quiser.');
    } finally {this.busy=false;this.emit();}
  }
  async pump() {
    if(!this.running) return;
    const current=this.now(),delta=current-this.lastNow;this.lastNow=current;
    if(!this.visible()||delta>5000||delta<0) {await this.pause(false);return;}
    this.elapsed+=delta/1000;
    if(this.mode!=='reading') this.remaining=Math.max(0,this.remaining-delta/1000);
    if(this.mode!=='reading'&&this.remaining===0) {
      const finished=this.mode;await this.pause(true);
      this.mode=finished==='pomodoro'?'break':'pomodoro';this.remaining=this.mode==='break'?300:1500;this.elapsed=0;
      this.emit(this.mode==='break'?'Foco concluído. Inicie a pausa de 5 minutos.':'Pausa concluída. Inicie outro foco de 25 minutos.');return;
    }
    if(this.mode!=='break'&&current-this.lastHeartbeat>=15000&&!this.inFlight) {
      this.lastHeartbeat=current;await this.send(false,true);
    }
    this.emit();
  }
}
