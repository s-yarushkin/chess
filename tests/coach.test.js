import test from 'node:test';
import assert from 'node:assert/strict';
import {coachingFor,MOTIFS} from '../src/coach.js';
test('prompt teaches calculation without leaking an exact move',()=>{
  for(const category of ['mate1','mate2','mate3','draw']){
    const x=coachingFor({category,theme:'mate'});
    assert.ok(x.prompt.length>45);
    assert.ok(x.method.length>6);
    assert.ok(!/[a-h][1-8][a-h][1-8]/.test(x.prompt));
  }
});
test('each tagged chess pattern has its own reflection',()=>{
  for(const motif of MOTIFS){
    const x=coachingFor({category:'mate2',theme:'mate '+motif[0]});
    assert.equal(x.focus,motif[1]);
    assert.ok(x.reflection.length>20);
  }
});
