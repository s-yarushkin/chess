import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bankPaymentUrl,donationInfo,DONATION_PHONE} from '../src/donation.js';
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
