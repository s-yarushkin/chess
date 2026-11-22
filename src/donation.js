// Never generate a fake SBP payment link from a phone number.
// Accept only HTTPS links issued by the recipient bank or SBP.
export const DONATION_PHONE='+79211282845';
export const DONATION_BANK='Ozon Банк';
const allowed=['ozon.ru','ozonbank.ru','nspk.ru'];
export function bankPaymentUrl(raw){
 if(typeof raw!=='string'||!raw.trim()||raw.length>2048)return null;
 try{
  const u=new URL(raw.trim());
  const host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password)return null;
  if(!allowed.some(domain=>host===domain||host.endsWith('.'+domain)))return null;
  return u.toString();
 }catch{return null;}
}
export function donationInfo(raw){
 return {phone:DONATION_PHONE,bank:DONATION_BANK,qrAvailable:!!bankPaymentUrl(raw)};
}
