import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCardLayout, resizedCardLayout } from '../js/utils/card-layout.js';

test('saved sizes stay inside grid and usable height bounds',()=>{
  assert.deepEqual(normalizeCardLayout({columns:99,height:5000}),{columns:12,height:900});
  assert.deepEqual(normalizeCardLayout({columns:-8,height:-20}),{columns:3,height:220});
  assert.deepEqual(normalizeCardLayout(),{columns:4,height:400});
});
test('resize snaps width to columns and height to stable increments',()=>{
  assert.deepEqual(resizedCardLayout({columns:4,height:400},200,83,1184),{columns:6,height:480});
  assert.deepEqual(resizedCardLayout({columns:4,height:400},-1000,-2000,1184),{columns:3,height:220});
});
