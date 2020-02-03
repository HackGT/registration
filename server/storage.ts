import * as fs from "fs";
import * as path from "path";
import { Readable } from "stream";
import * as AWS from "aws-sdk";
import {Storage} from "@google-cloud/storage";

/**
 * All uploaded files are initially saved in the OS's temp directory in case the files uploaded aren't valid
 * A storage engine takes this local path to the file on disk and does something with it to persist it for later reference
 *
 * The reference DiskStorageEngine simply moves the temporary file to the permanent upload directory
 */

export interface IStorageEngine {
	uploadRoot: string;
	saveFile(currentPath: string, name: string): Promise<void>;
	readFile(name: string): Promise<Readable>;
}
interface ICommonOptions {
	uploadDirectory: string;
}

class DiskStorageEngine implements IStorageEngine {
	public readonly uploadRoot: string;
	private readonly options: ICommonOptions;

	constructor(options: ICommonOptions) {
		// Values copied via spread operator instead of being passed by reference
		this.options = {
			...options
		};

		this.options.uploadDirectory = path.resolve(__dirname, "../", this.options.uploadDirectory);
		if (!fs.existsSync(this.options.uploadDirectory)) {
			fs.mkdirSync(this.options.uploadDirectory);
		}
		this.uploadRoot = this.options.uploadDirectory;
	}

	public saveFile(currentPath: string, name: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			// Apparently fs.rename() won't move across filesystems so we'll copy and delete instead
			// Error: EXDEV: cross-device link not permitted
			let readStream = fs.createReadStream(currentPath);
			let writeStream = fs.createWriteStream(path.join(this.options.uploadDirectory, name));
			readStream.on("error", reject);
			writeStream.on("error", reject);
			writeStream.on("close", () => {
				fs.unlink(currentPath, err => {
					if (err) {
						reject(err);
						return;
					}
					resolve();
				});
			});
			readStream.pipe(writeStream);
		});
	}
	public async readFile(name: string): Promise<Readable> {
		return fs.createReadStream(path.join(this.options.uploadDirectory, name));
	}
}

interface IS3Options extends ICommonOptions {
	bucket: string;
	region: string;
	accessKey: string;
	secretKey: string;
}

class S3StorageEngine implements IStorageEngine {
	public readonly uploadRoot: string;
	private readonly options: IS3Options;

	constructor(options: IS3Options) {
		// Values copied via spread operator instead of being passed by reference
		this.options = {
			...options
		};
		this.uploadRoot = this.options.uploadDirectory;
	}

	public saveFile(currentPath: string, name: string): Promise<void> {
		AWS.config.update({
			region: this.options.region,
			credentials: new AWS.Credentials({
				accessKeyId: this.options.accessKey,
				secretAccessKey: this.options.secretKey
			})
		});
		let s3 = new AWS.S3();
		return new Promise<void>((resolve, reject) => {
			let readStream = fs.createReadStream(currentPath);
			readStream.on("error", reject);
			s3.putObject({
				Body: readStream,
				Bucket: this.options.bucket,
				Key: name
			}).promise().then((output) => {
				resolve();
			}).catch(reject);
		});
	}
	public async readFile(name: string): Promise<Readable> {
		AWS.config.update({
			region: this.options.region,
			credentials: new AWS.Credentials({
				accessKeyId: this.options.accessKey,
				secretAccessKey: this.options.secretKey
			})
		});
		let s3 = new AWS.S3();
		const object = {
			Bucket: this.options.bucket,
			Key: name
		};
		// Will throw if the object does not exist
		await s3.headObject(object).promise();
		return s3.getObject(object).createReadStream();
	}
}

interface IGCSOptions extends ICommonOptions {
	bucket: string;
	client_email: string;
	private_key: string;
}

class GCSStorageEngine implements IStorageEngine {
	public readonly uploadRoot: string;
	private readonly options: IGCSOptions;
	private readonly storage: Storage;

	constructor(options: IGCSOptions) {
		// Values copied via spread operator instead of being passed by reference
		this.options = {
			...options
		};
		this.uploadRoot = this.options.uploadDirectory;
		this.storage = new Storage({
			credentials: {
				client_email: this.options.client_email,
				private_key: this.options.private_key
			}
		});
	}

	public async saveFile(currentPath: string, name: string): Promise<void> {
		await this.storage.bucket(this.options.bucket).upload(currentPath, {
			destination: name
		});
	}
	public async readFile(name: string): Promise<Readable> {
		return this.storage.bucket(this.options.bucket).file(name).createReadStream();
	}
}

interface IStorageEngines {
	[name: string]: new(options: ICommonOptions) => IStorageEngine;
}
export const storageEngines: IStorageEngines = {
	"disk": DiskStorageEngine,
	"s3": S3StorageEngine,
	"gcs": GCSStorageEngine
};
