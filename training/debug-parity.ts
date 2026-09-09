import { readFileSync, writeFileSync } from 'node:fs';
import { inferRows } from '../src/model/cpu.js';
function bytes(path:string){const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}
const rows=new Uint16Array(bytes('training/parity.rows.bin'));
const offsets=new Uint32Array(bytes('training/parity.offsets.bin'));
const expected=new Float32Array(bytes('training/parity.logits.bin'));
const boundaries=new Float32Array(bytes('training/parity.boundaries.bin'));
let worst={error:0,sequence:0,token:0,channel:0};
for(let sequence=0;sequence<offsets.length-1;sequence++){
 const start=offsets[sequence],end=offsets[sequence+1];
 const result=inferRows(rows.subarray(start*17,end*17),true);
 for(let token=start;token<end;token++){
  if(rows[token*17]===3)continue;
  for(let channel=0;channel<=40;channel++){
   const actual=channel===40?result.boundaryLogits![token-start]:result.logits![(token-start)*40+channel];
   const gold=channel===40?boundaries[token]:expected[token*40+channel];
   const error=Math.abs(actual-gold);
   if(error>worst.error)worst={error,sequence,token:token-start,channel};
  }
 }
}
const input=rows.subarray(offsets[worst.sequence]*17,offsets[worst.sequence+1]*17);
const result=inferRows(input,true);
writeFileSync('training/debug-parity.json',JSON.stringify({worst,rows:Array.from(input),trace:Object.fromEntries(Object.entries(result.trace!).map(([name,values])=>[name,Array.from(values)]))}));
console.log(worst);
