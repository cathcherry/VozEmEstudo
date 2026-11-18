import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFolderPng} from '../js/utils/folder-icons.js';

test('folder icon is optional and PNG content is accepted',async()=>{
  await validateFolderPng(null);
  await validateFolderPng(new Blob([new Uint8Array([137,80,78,71,13,10,26,10])]));
});
test('renamed HTML, JPEG and empty files cannot become folder PNGs',async()=>{
  for(const blob of [new Blob(['<script>bad</script>'],{type:'image/png'}),new Blob([new Uint8Array([255,216,255,0])]),new Blob([])]) {
    await assert.rejects(()=>validateFolderPng(blob),/PNG/);
  }
});
test('oversized icons are rejected before folder creation',async()=>{
  await assert.rejects(()=>validateFolderPng(new Blob([new Uint8Array(8*1024*1024+1)])),/8 MB/);
});
