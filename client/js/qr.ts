interface IQRCode {
	addData(data: string): void;
	make(): void;

	createSvgTag(): string;
	(typeNumber: number, errorCorrectionLevel: string): IQRCode;
}

declare let qrcode: IQRCode;

let typeNumber = 0;
let errorCorrectionLevel = "H";

let qr = qrcode(typeNumber, errorCorrectionLevel);
let qrElement = document.getElementById("qrCode") as HTMLElement;

qr.addData(qrElement.attributes.getNamedItem("data").value);
qr.make();

qrElement.innerHTML = qr.createSvgTag();

let qrSVGObject = qrElement.firstChild as HTMLImageElement;
qrSVGObject.removeAttribute("height");
qrSVGObject.removeAttribute("width");
