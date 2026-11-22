import QRCode from 'qrcode';
import {bankPaymentUrl,donationInfo} from './donation.js';
export const getDonationInfo=raw=>donationInfo(raw);
export async function getDonationQr(raw){
 const url=bankPaymentUrl(raw);
 if(!url)return null;
 return QRCode.toDataURL(url,{errorCorrectionLevel:'M',width:230,margin:2});
}
