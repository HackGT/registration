import * as path from "path";
import * as ajv from "ajv";
import * as moment from "moment-timezone";
import { QuestionBranchConfig, QuestionBranchSettings, IUser } from "./schema";
import { config, readFileAsync, renderMarkdown } from "./common";
import { QuestionBranches, Questions, TextBlocks } from "./config/questions.schema";

// tslint:disable:interface-name variable-name
interface Labels {
	[questionName: string]: string;
}
interface QuestionBranchTypes {
	"Application": ApplicationBranch;
	"Confirmation": ConfirmationBranch;
	"Noop": NoopBranch;
}
type QuestionBranch = QuestionBranchTypes[keyof QuestionBranchTypes];

const SCHEMA_FILE: string = "./config/questions.schema.json";

interface IQuestionBranchCache {
	[location: string]: QuestionBranches;
}
let QuestionBranchCache: IQuestionBranchCache = {};

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
		let questionBranches = QuestionBranchCache[this.location];
		if (!questionBranches) {
			QuestionBranchCache[this.location] = JSON.parse(await readFileAsync(this.location));
			questionBranches = QuestionBranchCache[this.location];

			let schema = JSON.parse(await readFileAsync(path.resolve(__dirname, SCHEMA_FILE)));
			let validator = new ajv();
			let valid = validator.validate(schema, questionBranches);
			if (!valid) {
				throw new Error(JSON.stringify(validator.errors));
			}
			let branchNames = questionBranches.map(branch => branch.name);
			if (new Set(branchNames).size !== branchNames.length) {
				throw new Error("Application branch names are not unique");
			}

			for (let questionBranch of questionBranches) {
				let renderedQuestions = [];
				for (let question of questionBranch.questions) {
					// Render labels
					question.label = await renderMarkdown(question.label, undefined, true);
					// Render options (if they exist)
					let type = question.type;
					if (type === "checkbox" || type === "radio" || type === "select") {
						if (question.hasOther) {
							question.options.push("Other");
						}
						let renderedOptions = [];
						for (let option of question.options) {
							renderedOptions.push(await renderMarkdown(option, undefined, true));
						}
						question.options = renderedOptions;
					}
					renderedQuestions.push(question);
				}
				questionBranch.questions = renderedQuestions;
			}
		}

		let cachedQuestionBranch = questionBranches.find(branch => branch.name === this.name);
		if (!cachedQuestionBranch) {
			throw new Error(`Branch "${this.name}" not found in schema (${this.location})`);
		}
		// This is a cheap way to "clone" the object so we don't have to worry about outside code's side effects or any global state
		cachedQuestionBranch = JSON.parse(JSON.stringify(cachedQuestionBranch)) as typeof cachedQuestionBranch;

		this.textBlocks = cachedQuestionBranch.text;
		this.questions = cachedQuestionBranch.questions;
		this.questionLabels = {};

		for (let i = 0; i < this.questions.length; i++) {
			this.questionLabels[this.questions[i].name] = this.questions[i].label;
		}

		await this.loadSettings();
		return this;
	}

	public async convertTo<T extends QuestionBranch>(type: keyof QuestionBranchTypes): Promise<T> {
		// TODO typecast and return if types match - do not need to save to DB
		await this.save();
		await QuestionBranchConfig.update({ "name": this.name }, { "$set": { "type": type } });
		// tslint:disable-next-line:no-use-before-declare
		return await BranchConfig.loadBranchFromDB(this.name) as T;
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
		this.open = branchConfig && branchConfig.settings && branchConfig.settings.open || new Date();
		this.close = branchConfig && branchConfig.settings && branchConfig.settings.close || new Date();
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
		this.confirmationBranches = branchConfig && branchConfig.settings && branchConfig.settings.confirmationBranches || [];
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

	public usesRollingDeadline: boolean;

	protected async loadSettings(): Promise<void> {
		await super.loadSettings();
		let branchConfig = await QuestionBranchConfig.findOne({ "name": this.name });
		this.usesRollingDeadline = branchConfig && branchConfig.settings && branchConfig.settings.usesRollingDeadline || false;
	}
	protected serializeSettings(): QuestionBranchSettings {
		return {
			...super.serializeSettings(),
			usesRollingDeadline: this.usesRollingDeadline
		};
	}
}

export class BranchConfig {
	public static async getNames(): Promise<string[]> {
		let questionBranches: QuestionBranches = JSON.parse(await readFileAsync(config.questionsLocation));
		return questionBranches.map(branch => branch.name);
	}
	public static async loadAllBranches(type: keyof QuestionBranchTypes | "All" = "All", location: string = config.questionsLocation): Promise<QuestionBranch[]> {
		let names = await this.getNames();
		let branches: QuestionBranch[] = [];
		for (let name of names) {
			let branch = await this.loadBranchFromDB(name, location);
			if (type === "All" || branch.type === type) {
				branches.push(branch);
			}
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
	public static async loadBranchFromDB(name: string, location: string = config.questionsLocation): Promise<QuestionBranch> {
		let branchConfig = await QuestionBranchConfig.findOne({ name });
		if (!branchConfig) {
			return await new NoopBranch(name, location).loadFromSchema();
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
				instance = await new NoopBranch(name, location || branchConfig.location).loadFromSchema();
		}

		return instance;
	}

	public static async getOpenBranches<T extends TimedBranch>(type: keyof QuestionBranchTypes): Promise<T[]> {
		let branches: TimedBranch[];
		switch (type) {
		case "Application":
			branches = (await this.loadAllBranches(type)) as ApplicationBranch[];
			break;
		case "Confirmation":
			branches = (await this.loadAllBranches(type)) as ConfirmationBranch[];
			break;
		default:
			branches = [];
			break;
		}
		return branches.filter(b => moment().isBetween(b.open, b.close)) as T[];
	}
}

// TODO move this to the user model?
export async function getOpenConfirmationBranches(user: IUser): Promise<ConfirmationBranch[]> {
	interface DeadlineMap {
		[name: string]: {
			name: string;
			open: Date;
			close: Date;
		};
	}
	let deadlines = user.confirmationDeadlines.reduce((map, data) => {
		map[data.name] = data;
		return map;
	}, {} as DeadlineMap);

	let branches = await (BranchConfig.loadAllBranches("Confirmation")) as ConfirmationBranch[];

	let now = moment();

	return branches.filter(b => {
			if (deadlines[b.name]) {
					return now.isBetween(deadlines[b.name].open, deadlines[b.name].close);
			}
			return now.isBetween(b.open, b.close);
	});
}
