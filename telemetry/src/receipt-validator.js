// No execution, regex scraping, truthiness coercion or semantic success inference.
export function validateReceipt(receipt,spec) {
 if(spec?.version!=='receipt-fields.v1'||!Array.isArray(spec.checks)||!spec.checks.length||spec.checks.length>32)throw new Error('unsupported receipt predicate');
 const checks=spec.checks.map(check=>{
  if(!Array.isArray(check.path)||!check.path.length||check.path.length>8||check.path.some(p=>typeof p!=='string'||!p||['__proto__','constructor','prototype'].includes(p))||!Object.hasOwn(check,'equals')||!['string','number','boolean'].includes(typeof check.equals))throw new Error('invalid literal predicate');
  let value=receipt;
  for(const key of check.path){if(!value||typeof value!=='object'||!Object.hasOwn(value,key))return 'unknown';value=value[key];}
  return Object.is(value,check.equals)?'supported':'contradicted';
 });
 return {version:spec.version,state:checks.includes('contradicted')?'contradicted':checks.includes('unknown')?'unknown':'supported',checks,scope:'literal-fields-only-not-semantic-task-acceptance'};
}
