let typeNumber = 0;
let errorCorrectionLevel = 'H';
declare var qrcode: any;
let qr = qrcode(typeNumber, errorCorrectionLevel);
let qrElement = document.getElementById('qrCode') as HTMLElement;

qr.addData(qrElement.attributes.getNamedItem('data').value);
qr.make();
// Let qrImage = qr.createImgTag() as HTMLImageElement;
let qrImageString: string = qr.createImgTag();

qrElement.innerHTML = qrImageString;

let qrImageObject = qrElement.firstChild as HTMLImageElement;

qrImageObject.removeAttribute('height');
qrImageObject.removeAttribute('width');
