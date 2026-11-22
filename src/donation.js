// Never generate a fake SBP payment link from a phone number.
// Accept only HTTPS links issued by the recipient bank or SBP.
// Public QR recipient link shared by the account owner; not a secret.
export const DEFAULT_DONATION_OZON_URL='https://finance.ozon.ru/apps/sbp/ozonbankpay/01a204e5-3d38-7ddd-a839-f4cf4724f89f';
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
 return {bank:DONATION_BANK,qrAvailable:!!bankPaymentUrl(raw)};
}
