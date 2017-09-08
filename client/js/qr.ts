let typeNumber = 0;
let errorCorrectionLevel = 'H';
declare var qrcode: any;
let qr = qrcode(typeNumber, errorCorrectionLevel);
let qrElement = document.getElementById('qrCode') as HTMLElement;

qr.addData(qrElement.attributes.getNamedItem('data').value);
qr.make();
qrElement.innerHTML = qr.createImgTag();
