export default async function handler(req, res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const { spot_id, email } = req.body || {};
  if(!spot_id || !email) return res.status(400).json({error:'Missing spot_id or email'});
  const key=process.env.RESEND_API_KEY;
  if(!key) return res.status(200).json({ok:true, demo:true});
  const r=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:'Bearer '+key, 'Content-Type':'application/json'},
    body: JSON.stringify({
      from:'Brand My Porsche <notify@brandmyporsche.com>',
      to: email,
      subject: "You've been outbid — spot #"+spot_id,
      html: '<p>You were outbid on spot #'+spot_id+'.</p><p><a href="https://brandmyporsche.com#auction">Outbid again in one click</a></p>'
    })
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok) return res.status(500).json({error:j});
  return res.status(200).json({ok:true});
}
