// Claude's JSON grammar supports a subset of JSON Schema. Keep unsupported
// constraints as model instructions; the original application validator remains
// authoritative after every paid response. No user schema is accepted here.
// https://platform.claude.com/docs/en/build-with-claude/structured-outputs
import { refuse } from './openrouter-policy.mjs';
const formats = new Set(['date-time','time','date','duration','email','hostname','uri','ipv4','ipv6','uuid']);
const annotations = new Set(['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','pattern','maxItems','uniqueItems']);
export function claudeOutputSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) refuse('unsupported', 'Invalid application output schema.');
  const out = {}, notes = [];
  for (const [key,value] of Object.entries(schema)) {
    if (annotations.has(key) || key === 'minItems' && ![0,1].includes(value) || key === 'format' && !formats.has(value)) {
      notes.push(`${key}: ${JSON.stringify(value)}`); continue;
    }
    if (['properties','$defs','definitions'].includes(key)) out[key] = Object.fromEntries(Object.entries(value).map(([k,v])=>[k,claudeOutputSchema(v)]));
    else if (['oneOf','anyOf','allOf'].includes(key)) out[key === 'oneOf' ? 'anyOf' : key] = value.map(claudeOutputSchema);
    else if (key === 'items') out.items = claudeOutputSchema(value);
    else if (key === 'additionalProperties') {
      if (value !== false) refuse('unsupported', 'Open-ended object schemas are not supported on this route.');
      out[key] = false;
    } else if (key === '$ref') {
      if (!value.startsWith('#/')) refuse('unsupported', 'External schema references are not supported.');
      out[key] = value;
    } else if (['type','required','enum','const','default','description','title','format','minItems'].includes(key)) out[key] = structuredClone(value);
    else refuse('unsupported', `Unsupported application schema keyword: ${key}.`);
  }
  if (out.type === 'object' || out.properties) out.additionalProperties = false;
  if (notes.length) out.description = [out.description, `Required constraints: ${notes.join('; ')}.`].filter(Boolean).join(' ');
  return out;
}
