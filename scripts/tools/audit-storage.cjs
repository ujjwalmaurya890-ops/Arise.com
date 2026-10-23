// Constant-key/wrapper inventory guard. Dynamic keys still need the documented audit.
const acorn=require('acorn'), fs=require('fs'),path=require('path');
const schema=require('../../src/cloud/storage-schema.js');
const root=path.resolve(__dirname,'../..');
process.chdir(root);
const files=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(p.endsWith('.js'))files.push(p)}}walk('src');files.push('assets/app-bundle.js');
const html=fs.readFileSync('index.html','utf8');const inputs=files.map(p=>[p,fs.readFileSync(p,'utf8')]);[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].forEach((m,i)=>inputs.push(['index#'+i,m[1]]));
const all=new Map(), unresolved=[]; let parseErrors=0;
for(const [file,src]of inputs){let ast;try{ast=acorn.parse(src,{ecmaVersion:'latest',sourceType:'module'})}catch(e){parseErrors++; console.error('PARSE',file,e.message);continue;}
const scopes=new WeakMap(), calls=[], functions=[], paramOwner=new WeakMap(), wrappers=new Map();
const root={parent:null,bindings:new Map(),fn:null};
function walkAst(n,scope){if(!n||typeof n.type!=='string')return;
 if(n.type==='FunctionDeclaration'){scope.bindings.set(n.id.name,{init:n,scope});}
 if(/Function(Expression|Declaration)$/.test(n.type)||n.type==='ArrowFunctionExpression'){
   const next={parent:scope,bindings:new Map(),fn:n};functions.push(n);
   n.params.forEach((p,i)=>{if(p.type==='Identifier'){const binding={param:true,index:i,fn:n,scope:next};next.bindings.set(p.name,binding);}});scope=next;
 }
 scopes.set(n,scope);
 if(n.type==='VariableDeclarator'&&n.id.type==='Identifier')scope.bindings.set(n.id.name,{init:n.init,scope});
 if(n.type==='CallExpression')calls.push(n);
 for(const [k,v]of Object.entries(n)){if(k==='start'||k==='end')continue;if(v&&typeof v.type==='string')walkAst(v,scope);else if(Array.isArray(v))v.forEach(x=>x?.type&&walkAst(x,scope));}
}
walkAst(ast,root);
function binding(name,scope){for(let s=scope;s;s=s.parent)if(s.bindings.has(name))return s.bindings.get(name);}
function val(node,scope,depth=0){if(!node||depth>20)return;scope=scopes.get(node)||scope;
 if(node.type==='Literal')return {value:node.value};
 if(node.type==='Identifier'){const b=binding(node.name,scope);if(!b)return;if(b.param)return b;return val(b.init,b.scope,depth+1);}
 if(/Function(Expression|Declaration)$/.test(node.type)||node.type==='ArrowFunctionExpression')return {fn:node};
 if(node.type==='ObjectExpression')return{object:node,scope};
 if(node.type==='MemberExpression'){
  const key=node.computed?val(node.property,scope,depth+1)?.value:node.property.name;
  const obj=val(node.object,scope,depth+1);
  const prop=obj?.object?.properties.find(p=>(p.key?.name||p.key?.value)===key);
  if(prop)return val(prop.value,obj.scope,depth+1);
 }
 if(node.type==='BinaryExpression'&&node.operator==='+'){const a=val(node.left,scope,depth+1),b=val(node.right,scope,depth+1);if(typeof a?.value==='string'&&b?.value!==undefined)return {value:a.value+b.value};}
 if(node.type==='CallExpression') { const target=val(node.callee,scope,depth+1); if(target?.fn&&!target.param&&target.fn.params.length===0) { const result=target.fn.body.type==='BlockStatement'?target.fn.body.body.find(item=>item.type==='ReturnStatement')?.argument:target.fn.body; return val(result,scopes.get(result)||scope,depth+1); } }
 if(node.type==='LogicalExpression'){return val(node.left,scope,depth+1)?.value?val(node.left,scope,depth+1):val(node.right,scope,depth+1);}
}
function prop(n){return n?.computed?n.property.value:n?.property?.name;}
function direct(call){const c=call.callee;return c.type==='MemberExpression'&&['getItem','setItem','removeItem'].includes(prop(c))&&(c.object.name==='localStorage'||prop(c.object)==='localStorage');}
let changed=true;
function keyArg(expr){const v=val(expr,scopes.get(expr));if(typeof v?.value==='string') {if(!all.has(v.value))all.set(v.value,new Set());all.get(v.value).add(file);}
 if(v?.param){let set=wrappers.get(v.fn);if(!set){set=new Set();wrappers.set(v.fn,set);}if(!set.has(v.index)){set.add(v.index);changed=true;}}
}
for(let i=0;i<12&&changed;i++){changed=false;for(const call of calls){
 if(direct(call)||['safeSet','safeGet','readVersioned','writeVersioned'].includes(prop(call.callee)))keyArg(call.arguments[0]);
 const c=val(call.callee,scopes.get(call));if(c?.fn&&wrappers.has(c.fn))for(const index of wrappers.get(c.fn))keyArg(call.arguments[index]);
}}
for(const call of calls)if(direct(call)&&!val(call.arguments[0],scopes.get(call.arguments[0]))?.value){const expr=call.arguments[0];if(expr?.type!=='Identifier')unresolved.push([file,src.slice(expr.start,expr.end)]);}
}
console.log('Audited ' + all.size + ' constant keys across ' + inputs.length + ' script inputs.');
let missing=0;
for(const [key,refs]of [...all].sort())if(!schema.isLocalKey(key)&&!schema.isLocalOnly(key)){ missing++; console.error('MISSING:',JSON.stringify(key),[...refs].join(', ')); }
console.log('Dynamic expressions requiring documented review:',JSON.stringify(unresolved));
process.exitCode=missing||parseErrors?1:0;
