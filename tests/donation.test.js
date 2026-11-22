import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bankPaymentUrl,donationInfo,DEFAULT_DONATION_OZON_URL} from '../src/donation.js';
import {getDonationQr} from '../src/donation-api.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('no fake payment QR from a phone number or unrelated URL',async()=>{
 for(const value of ['',undefined,'tel:+79211282845','http://finance.ozon.ru/x',
  'https://example.com/pay','https://ozon.ru.bad.example/x','https://me:secret@finance.ozon.ru/x']){
  assert.equal(bankPaymentUrl(value),null);
  assert.equal(await getDonationQr(value),null);
 }
 assert.deepEqual(donationInfo(''),{bank:'Ozon Банк',qrAvailable:false});
 assert.equal('phone' in donationInfo(''),false);
});
test('owner supplied Ozon QR URL is a supported bank address',async()=>{
 assert.equal(DEFAULT_DONATION_OZON_URL,'https://finance.ozon.ru/apps/sbp/ozonbankpay/01a204e5-3d38-7ddd-a839-f4cf4724f89f');
 assert.equal(bankPaymentUrl(DEFAULT_DONATION_OZON_URL),DEFAULT_DONATION_OZON_URL);
 const png=await getDonationQr(DEFAULT_DONATION_OZON_URL);
 assert.match(png,/^data:image\/png;base64,/);
 assert.ok(png.length>500);
});
test('bank-issued HTTPS link can become a locally rendered QR',async()=>{
 const u='https://finance.ozon.ru/pay?example=1';
 assert.equal(bankPaymentUrl(u),u);
 assert.equal(donationInfo(u).qrAvailable,true);
 const img=await getDonationQr(u);
 assert.match(img,/^data:image\/png;base64,/);
});
test('thanks dialog shows bank link before QR and instructions, without phone',()=>{
 const html=read('public/index.html'),js=read('public/donate.js'),
  css=read('public/style.css'),api=read('api/index.js');
 const popup=html.split('<dialog id="donateDialog"')[1].split('<dialog id="achievements"')[0];
 assert.match(popup,/Лёша, делай дальше бесплатные крутые продукты!/);
 for(const sum of ['30','50','100','custom']) assert.match(popup,new RegExp('data-amount="'+sum+'"'));
 assert.ok(popup.indexOf('id="donateQrLink"')<popup.indexOf('id="donateQrImage"'));
 assert.ok(popup.indexOf('id="donateQrImage"')<popup.indexOf('id="donateInstructions"'));
 assert.doesNotMatch(popup,/\+7\s*921|donatePhone|donateCopyPhone|donateCopyAll|Номер для перевода/);
 assert.match(popup,/перевод оформляет взрослый/i);
 assert.match(popup,/Донат не влияет на доступ/);
 assert.match(js,/No default donation/);
 assert.doesNotMatch(js,/navigator\.clipboard|donateCopyPhone|donateCopyAll/);
 assert.match(css,/#donateQrReady\[hidden\]/);
 assert.match(api,/api\/donation/);
});
