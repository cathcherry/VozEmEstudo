export function pendingMutation(send,uuid){let pending=null;return async(data)=>{
  const fingerprint=JSON.stringify(data);
  if(pending&&pending.fingerprint!==fingerprint)throw new Error('Confirme primeiro o envio anterior, repetindo os mesmos dados, ou recarregue a página para conferir o que foi salvo.');
  if(!pending)pending={fingerprint,wire:{...data,requestId:uuid()}};
  try{const result=await send(pending.wire);pending=null;return result;}
  catch(error){if(error.status&&error.status<500)pending=null;throw error;}
};}
