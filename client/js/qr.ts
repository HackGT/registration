interface IQRCode {
	addData(data: string): void;
	make(): void;

	createImgTag(): string;
	(typeNumber: number, errorCorrectionLevel: string): IQRCode;
}

declare var qrcode: IQRCode;

window.onload = () => {

	let typeNumber = 0;
	let errorCorrectionLevel = 'H';

	let qr = qrcode(typeNumber, errorCorrectionLevel);
	let qrElement = document.getElementById('qrCode') as HTMLElement;

	qr.addData(qrElement.attributes.getNamedItem('data').value);
	qr.make();

	let qrImageString: string = qr.createImgTag();

	qrElement.innerHTML = qrImageString;

	let qrImageObject = qrElement.firstChild as HTMLImageElement;

	qrImageObject.removeAttribute('height');
	qrImageObject.removeAttribute('width');

};
