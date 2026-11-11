import test from 'node:test';import assert from 'node:assert/strict';
const m=await import('../src/receipt-validator.js').catch(()=>({}));
test('exact typed fields validate narrow receipts, not text mentions or generic exits',()=>{
 assert.equal(typeof m.validateReceipt,'function');
 const spec={version:'receipt-fields.v1',checks:[{path:['downloaded_byte_match'],equals:true},{path:['visual_render_verified'],equals:false}]};
 assert.equal(m.validateReceipt({downloaded_byte_match:true,visual_render_verified:false},spec).state,'supported');
 assert.equal(m.validateReceipt({output:'downloaded_byte_match: true',exit_code:0},spec).state,'unknown');
 assert.equal(m.validateReceipt({downloaded_byte_match:false,visual_render_verified:false},spec).state,'contradicted');
 assert.equal(m.validateReceipt({downloaded_byte_match:'true',visual_render_verified:false},spec).state,'contradicted');
});
