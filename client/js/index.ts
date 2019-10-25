let typeNumber = 0;
let errorCorrectionLevel = "H";

let qr = qrcode(typeNumber, errorCorrectionLevel);
let qrElement = document.getElementById("qrCode") as HTMLElement;

let encoded = qrElement.dataset.encoded;
if (!encoded) {
	throw new Error("Data for QR code missing");
}
qr.addData(encoded);
qr.make();

qrElement.innerHTML = qr.createSvgTag();

let qrSVGObject = qrElement.firstChild as HTMLImageElement;
qrSVGObject.removeAttribute("height");
qrSVGObject.removeAttribute("width");
