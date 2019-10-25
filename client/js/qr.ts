interface IQRCode {
	addData(data: string): void;
	make(): void;

	createSvgTag(): string;
	createImgTag(cellSize?: number, margin?: number): string;
	(typeNumber: number, errorCorrectionLevel: string): IQRCode;
}

declare let qrcode: IQRCode;
