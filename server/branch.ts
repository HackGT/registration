import * as path from "path";
import * as ajv from "ajv";
import { QuestionBranchConfig, QuestionBranchSettings } from "./schema";
import { config, readFileAsync, renderMarkdown } from "./common";
import { QuestionBranches, Questions, TextBlocks } from "./config/questions.schema";

type Labels = {
	[questionName: string]: string;
};

type QuestionBranchTypes = {
	"Application": ApplicationBranch,
	"Confirmation": ConfirmationBranch,
	"Noop": NoopBranch
}
type QuestionBranch = QuestionBranchTypes[keyof QuestionBranchTypes];

const SCHEMA_FILE: string = "./config/questions.schema.json";

export class BranchConfig {
	public static async getNames(): Promise<string[]> {
		let questionBranches: QuestionBranches = JSON.parse(await readFileAsync(config.questionsLocation));
		return questionBranches.map(branch => branch.name);
	}
	public static async loadAllBranches(location: string = config.questionsLocation): Promise<QuestionBranch[]> {
		let names = await this.getNames();
		let branches: QuestionBranch[] = [];
		for (let name of names) {
			branches.push(await this.loadBranchFromDB(name, location));
		}
		return branches;
	}
	public static async verifyConfig(): Promise<boolean> {
		try {
			await this.loadAllBranches();
			return true;
		}
		catch {
			return false;
		}
	}
	public static async loadBranchFromDB(name: string, location?: string): Promise<QuestionBranch> {
		let branchConfig = await QuestionBranchConfig.findOne({ name });
		if (!branchConfig) {
			if (location) {
				return await new NoopBranch(name, location).loadFromSchema();
			}
			else {
				throw new Error("Config does not exist for specified branch name");
			}
		}

		let instance: QuestionBranch;
		switch (branchConfig.type) {
			case "Application":
				instance = await new ApplicationBranch(name, location || branchConfig.location).loadFromSchema();
				break;
			case "Confirmation":
				instance = await new ConfirmationBranch(name, location || branchConfig.location).loadFromSchema();
				break;
			default:
				instance = await new NoopBranch(name, location || branchConfig.location).loadFromSchema()
		}

		return instance;
	}
}

export class NoopBranch {
	public readonly name: string;
	public readonly type: keyof QuestionBranchTypes = "Noop";
	
	public textBlocks: TextBlocks | undefined;
	public questions: Questions;
	public questionLabels: Labels;
	
	protected readonly location: string;

	constructor(name: string, location: string) {
		this.name = name;
		this.location = location;
	}

	protected async loadSettings(): Promise<void> {
		return;
	}
	protected serializeSettings(): QuestionBranchSettings {
		// Noop branch has no settings
		return {};
	}

	public async loadFromSchema(): Promise<this> {
		let questionBranches: QuestionBranches = JSON.parse(await readFileAsync(this.location));
		let schema = JSON.parse(await readFileAsync(path.resolve(__dirname, SCHEMA_FILE)));

		let validator = new ajv();
		let valid = validator.validate(schema, questionBranches);
		let branchNames = questionBranches.map(branch => branch.name);
		let questionBranch = questionBranches.find(branch => branch.name === this.name);
		if (!valid) {
			throw new Error(JSON.stringify(validator.errors));
		}
		else if (new Set(branchNames).size !== branchNames.length) {
			throw new Error("Application branch names are not unique");
		}
		else if (!questionBranch) {
			throw new Error(`Branch "${this.name}" not found in schema (${this.location})`);
		}

		this.textBlocks = questionBranch.text;
		this.questions = questionBranch.questions;
		this.questionLabels = {};

		for (let i = 0; i < this.questions.length; i++) {
			// Render labels
			this.questions[i].label = await renderMarkdown(this.questions[i].label, undefined, true);
			this.questionLabels[this.questions[i].name] = this.questions[i].label;
			// Render options (if they exist)
			let type = this.questions[i].type;
			if (type === "checkbox" || type === "radio" || type === "select") {
				for (let k = 0; k < this.questions[i].options.length; k++) {
					this.questions[i].options[k] = await renderMarkdown(this.questions[i].options[k], undefined, true);
				}
			}
		}
		
		await this.loadSettings();
		return this;
	}

	public async convertTo<T extends QuestionBranch>(type: keyof QuestionBranchTypes): Promise<T> {
		await this.save();
		await QuestionBranchConfig.update({ "name": this.name }, { "$set": { "type": type } });
		return await loadBranchFromDB(this.name, this.location) as T;
	}

	public async save(): Promise<this> {
		let branchConfig = await QuestionBranchConfig.findOne({ "name": this.name });
		if (!branchConfig) {
			// Insert into DB
			await new QuestionBranchConfig({
				"name": this.name,
				"type": this.type,
				"location": this.location,
				"settings": this.serializeSettings()
			}).save();
		}
		else {
			// Update in DB
			branchConfig.name = this.name;
			branchConfig.type = this.type;
			branchConfig.location = this.location;
			branchConfig.settings = this.serializeSettings();
			await branchConfig.save();
		}

		return this;
	}
}

abstract class TimedBranch extends NoopBranch {
	public open: Date;
	public close: Date;

	protected async loadSettings(): Promise<void> {
		await super.loadSettings();
		let branchConfig = await QuestionBranchConfig.findOne({ "name": this.name });
		this.open = branchConfig && branchConfig.settings.open || new Date();
		this.close = branchConfig && branchConfig.settings.close || new Date();
	}
	protected serializeSettings(): QuestionBranchSettings {
		return {
			...super.serializeSettings(),
			open: this.open,
			close: this.close
		};
	}
}

export class ApplicationBranch extends TimedBranch {
	public readonly type: keyof QuestionBranchTypes = "Application";

	public confirmationBranches: string[];

	protected async loadSettings(): Promise<void> {
		await super.loadSettings();
		let branchConfig = await QuestionBranchConfig.findOne({ "name": this.name });
		this.confirmationBranches = branchConfig && branchConfig.settings.confirmationBranches || [];
	}
	protected serializeSettings(): QuestionBranchSettings {
		return {
			...super.serializeSettings(),
			confirmationBranches: this.confirmationBranches
		};
	}
}

export class ConfirmationBranch extends TimedBranch {
	public readonly type: keyof QuestionBranchTypes = "Confirmation";
}
