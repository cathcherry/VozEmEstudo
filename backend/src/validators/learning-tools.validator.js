import { z } from 'zod';
const uuid=z.string().uuid(),offset=z.coerce.number().int().min(0).max(1000000).default(0);
export const learningId=(value)=>uuid.parse(value);
const notePatch=z.object({noteText:z.string().trim().max(5000).optional(),color:z.enum(['yellow','green','blue']).optional(),deleted:z.boolean().optional()}).strict();
const anchor=z.object({sourceRevisionId:uuid,segmentPosition:z.number().int().min(0).optional(),
  startOffset:z.number().int().min(0).max(1000000).optional(),endOffset:z.number().int().positive().max(1000000).optional(),
  quote:z.string().min(1).max(1000).optional(),noteText:z.string().trim().max(5000).default(''),color:z.enum(['yellow','green','blue']).default('yellow'),
}).strict().refine((v)=>(v.noteText.length>0||Boolean(v.quote))&&(!v.quote||(v.segmentPosition!==undefined&&v.startOffset!==undefined&&v.endOffset>v.startOffset)));
export const validateAnnotation=(body)=>z.object({id:uuid,materialId:uuid,version:z.number().int().min(0),requestId:uuid,
  body:z.unknown()}).strict().transform((v)=>({...v,body:v.version===0?anchor.parse(v.body):notePatch.refine((p)=>Object.keys(p).length>0).parse(v.body)})).parse(body);
// Notes 3.0: an anchor may end in a later segment (at most 50 segments, quote joined by line breaks).
const lowerUuid=uuid.transform((v)=>v.toLowerCase());
const rangeAnchor=z.object({sourceRevisionId:lowerUuid,segmentPosition:z.number().int().min(0).optional(),endSegmentPosition:z.number().int().min(0).optional(),
  startOffset:z.number().int().min(0).max(1000000).optional(),endOffset:z.number().int().positive().max(1000000).optional(),
  quote:z.string().min(1).max(1000).optional(),noteText:z.string().trim().max(5000).default(''),color:z.enum(['yellow','green','blue']).default('yellow'),
}).strict().refine((v)=>{
  if(!(v.noteText.length>0||Boolean(v.quote)))return false;
  if(!v.quote)return v.segmentPosition===undefined&&v.endSegmentPosition===undefined&&v.startOffset===undefined&&v.endOffset===undefined;
  if(v.segmentPosition===undefined||v.startOffset===undefined||v.endOffset===undefined)return false;
  const end=v.endSegmentPosition??v.segmentPosition;
  return end>=v.segmentPosition&&end-v.segmentPosition<=49&&(end>v.segmentPosition||v.endOffset>v.startOffset);
});
export const validateAnnotationRange=(body)=>z.object({id:uuid,materialId:uuid,version:z.number().int().min(0),requestId:uuid,
  body:z.unknown()}).strict().transform((v)=>({...v,body:v.version===0?rangeAnchor.parse(v.body):notePatch.refine((p)=>Object.keys(p).length>0).parse(v.body)})).parse(body);
export const validateNoteQuery=(query)=>z.object({materialId:uuid.optional(),q:z.string().trim().max(200).default(''),offset}).strict().parse(query);
const eventBody=z.object({title:z.string().trim().min(1).max(200).optional(),description:z.string().max(3000).optional(),
  startsAt:z.string().datetime({offset:true}).optional(),endsAt:z.string().datetime({offset:true}).optional(),
  materialId:uuid.nullable().optional(),taskId:uuid.nullable().optional(),deleted:z.boolean().optional(),
}).strict().refine((b)=>Object.keys(b).length>0).refine((b)=>!b.startsAt||!b.endsAt||
  (Date.parse(b.endsAt)>Date.parse(b.startsAt)&&Date.parse(b.endsAt)-Date.parse(b.startsAt)<=7*86400000));
export const validateCalendarEvent=(body)=>z.object({id:uuid,version:z.number().int().min(0),requestId:uuid,body:eventBody}).strict()
  .refine((v)=>v.version>0||Boolean(v.body.title&&v.body.startsAt&&v.body.endsAt)).parse(body);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s)=>{const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;});
export const validateCalendarQuery=(query)=>z.object({from:z.string().datetime({offset:true}),to:z.string().datetime({offset:true}),
  fromDay:day,toDay:day,offset}).strict().refine((v)=>Date.parse(v.to)>Date.parse(v.from)&&Date.parse(v.to)-Date.parse(v.from)<=62*86400000&&
  Date.parse(v.toDay)>Date.parse(v.fromDay)&&Date.parse(v.toDay)-Date.parse(v.fromDay)<=62*86400000).parse(query);
export const validateShare=(body)=>z.object({id:uuid,requestId:uuid,token:z.string().regex(/^[0-9a-f]{64}$/),
  sourceRevisionId:uuid,includeTranscript:z.boolean(),includeSummary:z.boolean(),days:z.union([z.literal(1),z.literal(7),z.literal(30)]),
}).strict().refine((v)=>v.includeTranscript||v.includeSummary).parse(body);
export const validateSharePage=(query)=>z.object({offset}).strict().parse(query);
export const validatePublicToken=(body)=>z.object({token:z.string().regex(/^[0-9a-f]{64}$/)}).strict().parse(body).token;
