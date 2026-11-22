import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bankPaymentUrl,donationInfo,DONATION_PHONE,DEFAULT_DONATION_OZON_URL} from '../src/donation.js';
import {getDonationQr} from '../src/donation-api.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('no fake payment QR from phone number or unrelated URL',async()=>{
 assert.equal(DONATION_PHONE,'+79211282845');
 for(const value of ['',undefined,'tel:+79211282845','http://finance.ozon.ru/x',
  'https://example.com/pay','https://ozon.ru.bad.example/x','https://me:secret@finance.ozon.ru/x']){
  assert.equal(bankPaymentUrl(value),null);
  assert.equal(await getDonationQr(value),null);
 }
 assert.equal(donationInfo('')['qrAvailable'],false);
});
test('owner supplied Ozon QR URL is a supported official SBP recipient address',async()=>{
 assert.equal(DEFAULT_DONATION_OZON_URL,'https://finance.ozon.ru/apps/sbp/ozonbankpay/01a204e5-3d38-7ddd-a839-f4cf4724f89f');
 assert.equal(bankPaymentUrl(DEFAULT_DONATION_OZON_URL),DEFAULT_DONATION_OZON_URL);
 const png=await getDonationQr(DEFAULT_DONATION_OZON_URL);
 assert.ok(png.startsWith('data:image/png;base64,'));
 assert.ok(png.length>500);
});
test('bank-issued HTTPS link can become a genuine local QR',async()=>{
 const u='https://finance.ozon.ru/pay?example=1';
 assert.equal(bankPaymentUrl(u),u);
 assert.equal(donationInfo(u).qrAvailable,true);
 const img=await getDonationQr(u);
 assert.match(img,/^data:image\/png;base64,/);
 assert.ok(img.length>200);
});
test('thank-you UI supports small and custom amounts without pressuring children',()=>{
 const html=read('public/index.html'),js=read('public/donate.js'),
 css=read('public/style.css'),api=read('api/index.js');
 assert.match(html,/id="donateOpen"/);
 assert.match(html,/Лёша, делай дальше бесплатные крутые продукты!/);
 for(const amount of ['30','50','100','custom'])
  assert.match(html,new RegExp('data-amount="'+amount+'"'));
 assert.match(html,/Перевод оформляет взрослый/);
 assert.match(html,/Благодарность не влияет на доступ/);
 assert.match(html,/id="donateQrPending"/);
 assert.match(js,/navigator.clipboard.writeText/);
 assert.match(js,/Nothing selected by default/);
 assert.match(api,/api\/donation/);
 assert.match(css,/#donateQrReady\[hidden\]/);
});
