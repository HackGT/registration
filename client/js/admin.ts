class State {
	public id: string;
	private readonly sectionElement: HTMLElement;

	public static hideAll() {
		// tslint:disable-next-line:no-use-before-declare
		states.forEach(state => state.hide());
	}

	constructor(id: string) {
		this.id = id;
		let element = document.querySelector(`section#${id}`);
		if (!element) {
			throw new Error("ID does not correspond to an existing <section> element");
		}
		this.sectionElement = element as HTMLElement;
	}
	public hide(): void {
		this.sectionElement.style.display = "none";
	}
	public show(hideAll: boolean = true): void {
		if (hideAll) {
			State.hideAll();
		}
		this.sectionElement.style.display = "block";
	}
}
const states: State[] = ["statistics", "users", "applicants", "settings", "emails"].map(id => new State(id));

function generateFilter(branchFilter: HTMLInputElement, statusFilter: HTMLInputElement) {
	let filter: any = {};
	if (branchFilter.value !== "*" && branchFilter.value !== "na") {
		let [, type, branchName] = branchFilter.value.match(/^(application|confirmation)-(.*)$/)!;
		if (type === "application") {
			filter.applicationBranch = branchName;
		}
		else if (type === "confirmation") {
			filter.confirmationBranch = branchName;
		}
		switch (statusFilter.value) {
			case "no-submission":
				if (type === "confirmation") {
					filter.confirmed = false;
				}
				break;
			case "submitted":
				if (type === "confirmation") {
					filter.confirmed = true;
				} else {
					filter.applied = true;
				}
				break;
		}
	} else if (branchFilter.value === "na") {
		filter.applied = false;
	}
	return filter;
}
const batchEmailBranchFilterSelect = document.getElementById("email-branch-filter") as HTMLSelectElement;
const batchEmailStatusFilterSelect = document.getElementById("email-status-filter") as HTMLSelectElement;
async function batchEmailTypeChange(): Promise<void> {
	if (batchEmailBranchFilterSelect.value === "*" || batchEmailBranchFilterSelect.value === "na") {
		batchEmailStatusFilterSelect.style.display = "none";
	} else {
		for (let i = 0; i < batchEmailBranchFilterSelect.options.length; i++) {
			batchEmailStatusFilterSelect.options.remove(0);
		}
		batchEmailStatusFilterSelect.style.display = "block";
		let [, type ] = batchEmailBranchFilterSelect.value.match(/^(application|confirmation)-(.*)$/)!;
		// Only confirmation branches have no-submission option since confirmation is manually assigned
		if (type === "confirmation") {
			let noSubmission = new Option("Have not submitted (Confirmation)", "no-submission");
			batchEmailStatusFilterSelect.add(noSubmission);
		}
		let submitted = new Option(`Submitted (${type.charAt(0).toUpperCase() + type.slice(1)})`, "submitted");
		batchEmailStatusFilterSelect.add(submitted);
	}
}
batchEmailBranchFilterSelect.addEventListener("change", batchEmailTypeChange);
batchEmailTypeChange().catch(err => {
	console.error(err);
});

class UserEntries {
	private static readonly NODE_COUNT = 20;
	private static nodes: HTMLTableRowElement[] = [];
	private static offset: number = 0;
	private static readonly previousButton = document.getElementById("users-entries-previous") as HTMLButtonElement;
	private static readonly nextButton = document.getElementById("users-entries-next") as HTMLButtonElement;

	private static instantiate() {
		const userEntryTemplate = document.getElementById("user-entry") as HTMLTemplateElement;
		const userEntryTableBody = document.querySelector("#users > table > tbody") as HTMLTableSectionElement;
		for (let i = this.nodes.length; i < this.NODE_COUNT; i++) {
			let node = document.importNode(userEntryTemplate.content, true);
			userEntryTableBody.appendChild(node);
			this.nodes.push(userEntryTableBody.querySelectorAll("tr")[i]);
		}
	}
	private static load() {
		const status = document.getElementById("users-entries-status") as HTMLParagraphElement;
		status.textContent = "Loading...";

		let query = `
		query($offset: Int!, $count: Int!) {
			search_user(search: "", offset: $offset, n: $count) {
				offset,
				count,
				total,
				users {
					id,
					name,
					email,
					admin,

					application {
						type
					},
					confirmation {
						type
					},
					applied,
					accepted,
					confirmed
				}
			}
		}`;
		let variables = {
			offset: this.offset,
			count: this.NODE_COUNT
		};

		fetch("/graphql", {
			credentials: "same-origin",
			method: "POST",
			headers: new Headers({
				"Content-Type": "application/json"
			}),
			body: JSON.stringify({
				query,
				variables
			})
		}).then(checkStatus).then(parseJSON).then((response: {
			data: {
				search_user: {
					offset: number;
					count: number;
					total: number;
					users: any[];
				};
			};
		}) => {
			let res = response.data.search_user;

			for (let i = 0; i < this.NODE_COUNT; i++) {
				let node = this.nodes[i];
				let user = res.users[i];

				if (user) {
					node.style.display = "table-row";
					node.querySelector("td.name")!.textContent = user.name;
					node.querySelector("td.email > span")!.textContent = user.email;
					node.querySelector("td.email")!.classList.remove("admin");
					if (user.admin) {
						node.querySelector("td.email")!.classList.add("admin");
					}

					let userStatus = "Signed up";
					if (user.applied) {
						userStatus = `Applied (${user.application.type})`;
					}
					if (user.applied && user.accepted) {
						userStatus = `Accepted (${user.application.type})`;
					}
					if (user.applied && user.accepted && user.confirmed) {
						userStatus = `Accepted (${user.application.type}) / Confirmed`;
					}
					if (user.applied && user.accepted && user.confirmed && user.confirmation) {
						userStatus = `Accepted (${user.application.type}) / Confirmed (${user.confirmation.type})`;
					}
					node.querySelector("td.status")!.textContent = userStatus;
				}
				else {
					node.style.display = "none";
				}
			}

			if (res.offset <= 0) {
				this.previousButton.disabled = true;
			}
			else {
				this.previousButton.disabled = false;
			}
			let upperBound = res.offset + res.count;
			if (upperBound >= res.total) {
				upperBound = res.total;
				this.nextButton.disabled = true;
			}
			else {
				this.nextButton.disabled = false;
			}
			let lowerBound = res.offset + 1;
			if (res.users.length <= 0) {
				lowerBound = 0;
			}
			status.textContent = `${lowerBound} – ${upperBound} of ${res.total.toLocaleString()}`;
		}).catch(async err => {
			console.error(err);
			await sweetAlert("Oh no!", err.message, "error");
		});
	}

	public static setup() {
		this.nodes = [];
		this.instantiate();
		this.offset = 0;
		this.load();
		this.previousButton.addEventListener("click", () => {
			this.previous();
		});
		this.nextButton.addEventListener("click", () => {
			this.next();
		});
	}
	public static next() {
		this.offset += this.NODE_COUNT;
		this.load();
	}
	public static previous() {
		this.offset -= this.NODE_COUNT;
		if (this.offset < 0) {
			this.offset = 0;
		}
		this.load();
	}
}

class ApplicantEntries {
	private static readonly NODE_COUNT = 10;
	private static generalNodes: HTMLTableRowElement[] = [];
	private static detailsNodes: HTMLTableRowElement[] = [];
	private static offset: number = 0;
	private static readonly searchButton = document.getElementById("applicant-search-execute") as HTMLButtonElement;
	private static readonly previousButton = document.getElementById("applicants-entries-previous") as HTMLButtonElement;
	private static readonly nextButton = document.getElementById("applicants-entries-next") as HTMLButtonElement;
	private static readonly branchFilter = document.getElementById("branch-filter") as HTMLInputElement;
	private static readonly searchBox = document.getElementById("applicant-search") as HTMLInputElement;
	private static readonly searchRegex = document.getElementById("applicant-search-regex") as HTMLInputElement;
	private static filter: any = {};

	private static instantiate() {
		const applicantEntryTemplate = document.getElementById("applicants-entry") as HTMLTemplateElement;
		const applicantEntryTableBody = document.querySelector("#applicants > table > tbody") as HTMLTableSectionElement;
		for (let i = this.generalNodes.length; i < this.NODE_COUNT; i++) {
			let node = document.importNode(applicantEntryTemplate.content, true);
			applicantEntryTableBody.appendChild(node);
			this.generalNodes.push(applicantEntryTableBody.querySelectorAll("tr.general")[i] as HTMLTableRowElement);
			applicantEntryTableBody.querySelectorAll("tr.general")[i].querySelector("select.status")!.addEventListener("change", e => {
				let statusSelect = e.target as HTMLSelectElement;
				statusSelect.disabled = true;
				let id = statusSelect.parentElement!.parentElement!.dataset.id!;
				let formData = new FormData();
				formData.append("status", statusSelect.value);

				fetch(`/api/user/${id}/status`, {
					credentials: "same-origin",
					method: "POST",
					body: formData
				}).then(checkStatus).then(parseJSON).then(async () => {
					statusSelect.disabled = false;
					this.load();
				}).catch(async (err: Error) => {
					await sweetAlert("Oh no!", err.message, "error");
					statusSelect.disabled = false;
				});
			});
			this.detailsNodes.push(applicantEntryTableBody.querySelectorAll("tr.details")[i] as HTMLTableRowElement);
		}
	}
	private static updateFilter() {
		this.filter = {};

		if (this.branchFilter.value !== "*") {
			let [, type, branchName] = this.branchFilter.value.match(/^(application|confirmation)-(.*)$/)!;
			if (type === "application") {
				this.filter.application_branch = branchName;
			}
			else if (type === "confirmation") {
				this.filter.confirmation_branch = branchName;
			}
		}

		this.offset = 0;
		this.load();
	}
	public static load() {
		const status = document.getElementById("applicants-entries-status") as HTMLParagraphElement;
		status.textContent = "Loading...";

		let query = `
		query($search: String!, $useRegex: Boolean!, $offset: Int!, $count: Int!, $filter: UserFilter!) {
			search_user(search: $search, use_regex: $useRegex, offset: $offset, n: $count, filter: $filter) {
				offset,
				count,
				total,
				users {
					id,
					name,
					email,
					admin,
					team {
						id,
						name
					},
					accepted,
					confirmed,
					confirmationBranch,
					application {
						type,
						data {
							name,
							label,
							value,
							values,
							file {
								mimetype,
								size_formatted,
								path
							}
						}
					},
					confirmation {
						type,
						data {
							name,
							label,
							value,
							values,
							file {
								mimetype,
								size_formatted,
								path
							}
						}
					}
				}
			}
		}`;
		let variables = {
			search: this.searchBox.value,
			useRegex: this.searchRegex.checked,
			offset: this.offset,
			count: this.NODE_COUNT,
			filter: {
				applied: true,
				...this.filter
			}
		};

		fetch("/graphql", {
			credentials: "same-origin",
			method: "POST",
			headers: new Headers({
				"Content-Type": "application/json"
			}),
			body: JSON.stringify({
				query,
				variables
			})
		}).then(checkStatus).then(parseJSON).then((response: {
			data: {
				search_user: {
					offset: number;
					count: number;
					total: number;
					users: any[];
				};
			};
		}) => {
			let res = response.data.search_user;

			interface IFormItem {
				name: string;
				label: string;
				type: string;
				value?: string;
				values?: string[];
				file?: {
					original_name: string;
					encoding: string;
					mimetype: string;
					path: string;
					size: number;
					size_formatted: string;
				};
			}
			function addApplicationData(dataSection: HTMLDivElement, applicationData: IFormItem[]): void {
				for (let answer of applicationData as IFormItem[]) {
					let row = document.createElement("p");
					let label = document.createElement("b");
					label.innerHTML = answer.label;
					row.appendChild(label);
					let value = "";
					if (answer.value) {
						value = answer.value;
					}
					else if (answer.values) {
						value = answer.values.join(", ");
					}
					else if (answer.file) {
						value = `[${answer.file.mimetype} | ${answer.file.size_formatted}]: ${answer.file.path}`;
					}
					row.appendChild(document.createTextNode(` → ${value}`));
					if (answer.file) {
						row.appendChild(document.createTextNode(" ("));
						let link = document.createElement("a");
						link.setAttribute("href", `/${answer.file.path}`);
						link.textContent = "Download";
						row.appendChild(link);
						row.appendChild(document.createTextNode(")"));
					}
					dataSection.appendChild(row);
				}
			}
			function addApplicationDataHeader(dataSection: HTMLDivElement, content: string): void {
				let header = document.createElement("h4");
				header.textContent = content;
				dataSection.appendChild(header);
			}

			for (let i = 0; i < this.NODE_COUNT; i++) {
				let generalNode = this.generalNodes[i];
				let detailsNode = this.detailsNodes[i];
				let user = res.users[i];

				if (user) {
					generalNode.style.display = "table-row";
					detailsNode.style.display = "table-row";

					generalNode.dataset.id = user.id;
					generalNode.querySelector("td.name")!.textContent = user.name;
					generalNode.querySelector("td.team")!.textContent = "";
					if (user.team) {
						let teamContainer = document.createElement("b");
						teamContainer.textContent = user.team.name;
						generalNode.querySelector("td.team")!.appendChild(teamContainer);
					}
					else {
						generalNode.querySelector("td.team")!.textContent = "No Team";
					}
					generalNode.querySelector("td.email > span")!.textContent = user.email;
					generalNode.querySelector("td.email")!.classList.remove("admin");
					if (user.admin) {
						generalNode.querySelector("td.email")!.classList.add("admin");
					}
					generalNode.querySelector("td.branch")!.textContent = user.application.type;
					let statusSelect = generalNode.querySelector("select.status") as HTMLSelectElement;
					statusSelect.value = user.confirmationBranch ? user.confirmationBranch : "no-decision";

					let dataSection = detailsNode.querySelector("div.applicantData") as HTMLDivElement;
					while (dataSection.hasChildNodes()) {
						dataSection.removeChild(dataSection.lastChild!);
					}

					if (user.application) {
						addApplicationDataHeader(dataSection, `Application data (${user.application.type})`);
						addApplicationData(dataSection, user.application.data);
					}
					else {
						addApplicationDataHeader(dataSection, "No application data");
					}
					if (user.confirmation) {
						addApplicationDataHeader(dataSection, `Confirmation data (${user.confirmation.type})`);
						addApplicationData(dataSection, user.confirmation.data);
					}
					else {
						addApplicationDataHeader(dataSection, "No confirmation data");
					}
				}
				else {
					generalNode.style.display = "none";
					detailsNode.style.display = "none";
				}
			}

			if (res.offset <= 0) {
				this.previousButton.disabled = true;
			}
			else {
				this.previousButton.disabled = false;
			}
			let upperBound = res.offset + res.count;
			if (upperBound >= res.total) {
				upperBound = res.total;
				this.nextButton.disabled = true;
			}
			else {
				this.nextButton.disabled = false;
			}
			let lowerBound = res.offset + 1;
			if (res.users.length <= 0) {
				lowerBound = 0;
			}
			status.textContent = `${lowerBound} – ${upperBound} of ${res.total.toLocaleString()}`;
		}).catch(async err => {
			console.error(err);
			await sweetAlert("Oh no!", err.message, "error");
		});
	}

	public static setup() {
		this.generalNodes = [];
		this.detailsNodes = [];
		this.instantiate();
		this.offset = 0;
		this.updateFilter();
		this.searchButton.addEventListener("click", () => {
			this.updateFilter();
		});
		this.searchBox.addEventListener("keydown", event => {
			if (event.key === "Enter") {
				this.updateFilter();
			}
		});
		this.previousButton.addEventListener("click", () => {
			this.previous();
		});
		this.nextButton.addEventListener("click", () => {
			this.next();
		});
		this.branchFilter.addEventListener("change", e => {
			this.updateFilter();
		});
	}
	public static next() {
		document.querySelector("#applicants > table")!.scrollIntoView();
		this.offset += this.NODE_COUNT;
		this.load();
	}
	public static previous() {
		document.querySelector("#applicants > table")!.scrollIntoView();
		this.offset -= this.NODE_COUNT;
		if (this.offset < 0) {
			this.offset = 0;
		}
		this.load();
	}
}

// Set the correct state on page load
function readURLHash() {
	let urlState: State | null = null;
	for (let i = 0; i < states.length; i++) {
		if (states[i].id === window.location.hash.substr(1)) {
			urlState = states[i];
			break;
		}
	}
	if (urlState) {
		urlState.show();
	}
	else {
		// Show first section
		states[0].show();
	}
}

(function setup() {
	readURLHash();
	UserEntries.setup();
	ApplicantEntries.setup();
})();
// Load the correct state on button press
window.addEventListener("hashchange", readURLHash);

//
// Applicants
//

const sendAcceptancesButton = document.getElementById("send-acceptances") as HTMLButtonElement;
sendAcceptancesButton.addEventListener("click", async e => {
	let sendCount: number = (await fetch(`/api/user/all/send_acceptances`, {
		credentials: "same-origin",
		method: "POST"
	}).then(checkStatus).then(parseJSON)).count;
	await sweetAlert("Success!", `Acceptance emails sent (${sendCount} in all).`, "success");
});

//
// Email content
//
declare const EasyMDE: typeof import("easymde");

const emailTypeSelect = document.getElementById("email-type") as HTMLSelectElement;
const emailSubject = document.getElementById("email-subject") as HTMLInputElement;
let emailRenderedArea: HTMLElement | ShadowRoot = document.getElementById("email-rendered") as HTMLElement;
if (document.head.attachShadow) {
	// Browser supports Shadow DOM
	emailRenderedArea = emailRenderedArea.attachShadow({ mode: "open" });
}
const markdownEditor = new EasyMDE({ element: document.getElementById("email-content")! });
let contentChanged = false;
let lastSelected = emailTypeSelect.value;

const debounceTimeout = 500; // Milliseconds to wait before content is rendered to avoid hitting the server for every keystroke
function debounce(func: () => void): () => void {
	let timer: number | null = null;
	return () => {
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(func, debounceTimeout);
	};
}

markdownEditor.codemirror.on("change", debounce(async () => {
	contentChanged = true;
	try {
		let content = new FormData();
		content.append("content", markdownEditor.value());

		let { html, text }: { html: string; text: string } = (
			await fetch(`/api/settings/email_content/${encodeURIComponent(emailTypeSelect.value)}/rendered`, {
				credentials: "same-origin",
				method: "POST",
				body: content
			}).then(checkStatus).then(parseJSON)
		);
		emailRenderedArea.innerHTML = html;
		let hr = document.createElement("hr");
		hr.style.border = "1px solid #737373";
		emailRenderedArea.appendChild(hr);
		let textContainer = document.createElement("pre");
		textContainer.textContent = text;
		emailRenderedArea.appendChild(textContainer);
	}
	catch {
		emailRenderedArea.textContent = "Couldn't retrieve email content";
	}
}));

async function emailTypeChange(): Promise<void> {
	if (contentChanged) {
		let shouldProceed = confirm("Heads up! You've edited the content of this email but haven't saved it. Click cancel to stay and save.");
		if (!shouldProceed) {
			emailTypeSelect.value = lastSelected;
			return;
		}
	}

	// Load editor content via AJAX
	try {
		let emailSettings: { subject: string; content: string } = await fetch(`/api/settings/email_content/${encodeURIComponent(emailTypeSelect.value)}`, { credentials: "same-origin" }).then(checkStatus).then(parseJSON);
		emailSubject.value = emailSettings.subject;
		markdownEditor.value(emailSettings.content);
	}
	catch {
		markdownEditor.value("Couldn't retrieve email content");
	}
	contentChanged = false;
	lastSelected = emailTypeSelect.value;
}
emailTypeSelect.addEventListener("change", emailTypeChange);
emailTypeChange().catch(err => {
	console.error(err);
});

//
// Settings
//

// Load timezone-correct values for the application open / close time
let timeInputs = document.querySelectorAll('input[type="datetime-local"]') as NodeListOf<HTMLInputElement>;
for (let i = 0; i < timeInputs.length; i++) {
	timeInputs[i].value = moment(new Date(timeInputs[i].dataset.rawValue || "")).format("Y-MM-DDTHH:mm:00");
}

// Settings update
let settingsUpdateButtons = document.querySelectorAll("#settings input[type=submit]") as NodeListOf<HTMLInputElement>;
let settingsForm = document.querySelector("#settings form") as HTMLFormElement;
for (let i = 0; i < settingsUpdateButtons.length; i++) {
	settingsUpdateButtons[i].addEventListener("click", settingsUpdate);
}
function settingsUpdateButtonDisabled(disabled: boolean) {
	for (let i = 0; i < settingsUpdateButtons.length; i++) {
		settingsUpdateButtons[i].disabled = disabled;
	}
}

function settingsUpdate(e: MouseEvent) {
	if (!settingsForm.checkValidity() || !settingsForm.dataset.action) {
		return;
	}
	e.preventDefault();
	settingsUpdateButtonDisabled(true);

	let teamsEnabledData = new FormData();
	teamsEnabledData.append("enabled", (document.getElementById("teams-enabled") as HTMLInputElement).checked ? "true" : "false");

	let qrEnabledData = new FormData();
	qrEnabledData.append("enabled", (document.getElementById("qr-enabled") as HTMLInputElement).checked ? "true" : "false");

	let adminEmailData = new FormData();
	adminEmailData.append("adminString", (document.getElementById("admin-emails") as HTMLInputElement).value);
	adminEmailData.append("addAdmins", (document.getElementById("add-admins") as HTMLInputElement).checked ? "true" : "false");

	let branchRoleData = new FormData();
	let branchRoles = document.querySelectorAll("div.branch-role") as NodeListOf<HTMLDivElement>;
	for (let i = 0; i < branchRoles.length; i++) {
		let branchName = branchRoles[i].dataset.name!;
		let branchRole = branchRoles[i].querySelector("select")!.value as "Noop" | "Application" | "Confirmation";
		let branchData: {
			role: string;
			open?: Date;
			close?: Date;
			usesRollingDeadline?: boolean;
			isAcceptance?: boolean;
			autoConfirm?: boolean;
			autoAccept?: string;
			allowAnonymous?: boolean;
		} = {role: branchRole};
		if (branchRole !== "Noop") {
				let openInputElem = branchRoles[i].querySelector("input.openTime") as HTMLInputElement;
				let closeInputElem = branchRoles[i].querySelector("input.closeTime") as HTMLInputElement;
				branchData.open = openInputElem ? new Date(openInputElem.value) : new Date();
				branchData.close = closeInputElem ? new Date(closeInputElem.value) : new Date();
		}
		if (branchRole === "Application") {
			// This operation is all or nothing because it will only error if a branch was just made into an Application branch
			try {
				let applicationBranchOptions = branchRoles[i].querySelector("fieldset.applicationBranchOptions") as Element;
				branchData.allowAnonymous = (applicationBranchOptions.querySelector("input[type=\"checkbox\"].allowAnonymous") as HTMLInputElement).checked;
				branchData.autoAccept = (applicationBranchOptions.querySelector("select.autoAccept") as HTMLInputElement).value;
			} catch {
				branchData.allowAnonymous = false;
				branchData.autoAccept = "disabled";
			}
		}
		if (branchRole === "Confirmation") {
			let confirmationBranchOptions = branchRoles[i].querySelector("fieldset.confirmationBranchOptions") as Element;
			try {
				branchData.usesRollingDeadline = (confirmationBranchOptions.querySelector("input[type=\"checkbox\"].usesRollingDeadline") as HTMLInputElement).checked;
				branchData.isAcceptance = (confirmationBranchOptions.querySelector("input[type=\"checkbox\"].isAcceptance") as HTMLInputElement).checked;
				branchData.autoConfirm = (confirmationBranchOptions.querySelector("input[type=\"checkbox\"].autoConfirm") as HTMLInputElement).checked;
			} catch {
				branchData.usesRollingDeadline = false;
				branchData.isAcceptance = true;
				branchData.autoConfirm = false;
			}

		}
		branchRoleData.append(branchName, JSON.stringify(branchData));
	}

	let emailContentData = new FormData();
	emailContentData.append("subject", emailSubject.value);
	emailContentData.append("content", markdownEditor.value());

	const defaultOptions: RequestInit = {
		credentials: "same-origin",
		method: "PUT"
	};
	fetch("/api/settings/teams_enabled", {
		...defaultOptions,
		body: teamsEnabledData
	}).then(checkStatus).then(parseJSON).then(() => {
		return fetch("/api/settings/qr_enabled", {
			...defaultOptions,
			body: qrEnabledData
		});
	}).then(checkStatus).then(parseJSON).then(() => {
		return fetch("/api/settings/admin_emails", {
			...defaultOptions,
			body: adminEmailData
		});
	}).then(checkStatus).then(parseJSON).then(() => {
		return fetch("/api/settings/branch_roles", {
			...defaultOptions,
			body: branchRoleData
		});
	}).then(checkStatus).then(parseJSON).then(() => {
		if (emailTypeSelect.value) {
			return fetch(`/api/settings/email_content/${encodeURIComponent(emailTypeSelect.value)}`, {
				...defaultOptions,
				body: emailContentData
			}).then(checkStatus).then(parseJSON);
		}
		else {
			return Promise.resolve();
		}
	}).then(async () => {
		await sweetAlert("Awesome!", "Settings successfully updated.", "success");
		window.location.reload();
	}).catch(async (err: Error) => {
		await sweetAlert("Oh no!", err.message, "error");
		settingsUpdateButtonDisabled(false);
	});
}

//
// Graphs
//

// Embedded by Handlebars in admin.html
declare let data: {
	questionName: string;
	branch: string;
	responses: {
		response: string;
		count: number;
	}[];
}[];
declare const Chart: any;

// Get the text color and use that for graphs
const color = window.getComputedStyle(document.querySelector("thead")!).getPropertyValue("border-color");

for (let i = 0; i < data.length; i++) {
	let context = document.getElementById(`chart-${i}`) as HTMLCanvasElement | null;
	if (!context) {
		console.warn(`Canvas with ID "chart-${i}" does not exist`);
		continue;
	}

	const MAX_SIZE = 50;
	new Chart(context, {
		"type": "bar",
		"data": {
			"labels": data[i].responses.map(response => response.response),
			"datasets": [{
				"label": "Count",
				"data": data[i].responses.map(response => response.count),
				"backgroundColor": Array(data[i].responses.length).fill(color)
			}]
		},
		"options": {
			"legend": {
				"display": false
			},
			"scales": {
				"yAxes": [{
					"ticks": {
						"fontColor": color,
						"beginAtZero": true,
						"precision": 0 // Only integers
					},
					"gridLines": {
						"zeroLineColor": color
					}
				}],
				"xAxes": [{
					"stacked": false,
					"ticks": {
						"fontColor": color,
						"stepSize": 1,
						"autoSkip": false,
						"minRotation": 0,
						"maxRotation": 60,
						"callback": (value: string, index: number, values: string[]) => {
							if (value.length > MAX_SIZE) {
								value = value.substr(0, MAX_SIZE) + "...";
							}
							return value;
						}
					},
					"gridLines": {
						"zeroLineColor": color
					}
				}]
			},
			"tooltips": {
				"callbacks": {
					"title": (tooltipItem: any, graphData: any) => {
						let title: string = graphData.labels[tooltipItem[0].index];
						let titleWithLineBreaks = "";
						while (title.length > 0) {
							titleWithLineBreaks += title.substring(0, MAX_SIZE);
							if (title.length > MAX_SIZE) {
								titleWithLineBreaks += "\n";
							}
							title = title.substring(MAX_SIZE);
						}
						return titleWithLineBreaks;
					}
				}
			}
		}
	});
}

let emailBranchFilter = document.getElementById("email-branch-filter") as HTMLInputElement;
let emailStatusFilter = document.getElementById("email-status-filter") as HTMLInputElement;
let sendEmailButton = document.getElementById("sendEmail") as HTMLButtonElement;
let batchEmailSubject = document.getElementById("batch-email-subject") as HTMLInputElement;
let batchEmailEditor = new EasyMDE({ element: document.getElementById("batch-email-content")! });
let batchEmailRenderedArea: HTMLElement | ShadowRoot = document.getElementById("batch-email-rendered") as HTMLElement;
if (document.head.attachShadow) {
	// Browser supports Shadow DOM
	batchEmailRenderedArea = batchEmailRenderedArea.attachShadow({ mode: "open" });
}
batchEmailEditor.codemirror.on("change", async () => {
	try {
		let content = new FormData();
		content.append("content", batchEmailEditor.value());
		let { html, text }: { html: string; text: string } = (
			await fetch(`/api/settings/email_content/batch_email/rendered`, {
				credentials: "same-origin",
				method: "POST",
				body: content
			}).then(checkStatus).then(parseJSON)
		);
		batchEmailRenderedArea.innerHTML = html;
		let hr = document.createElement("hr");
		hr.style.border = "1px solid #737373";
		batchEmailRenderedArea.appendChild(hr);
		let textContainer = document.createElement("pre");
		textContainer.textContent = text;
		batchEmailRenderedArea.appendChild(textContainer);
	}
	catch {
		batchEmailRenderedArea.textContent = "Couldn't retrieve email content";
	}
});
sendEmailButton.addEventListener("click", () => {
	let subject = batchEmailSubject.value;
	let markdownContent = batchEmailEditor.value();
	if (subject === "") {
		return sweetAlert("Oh no!", "You need an email subject", "error");
	} else if (markdownContent  === "") {
		return sweetAlert("Oh no!", "Your email body is empty.", "error");
	}
	let filter = generateFilter(emailBranchFilter, emailStatusFilter);
	let content = new FormData();
	content.append("filter", JSON.stringify(filter));
	content.append("subject", subject);
	content.append("markdownContent", markdownContent);
	sendEmailButton.disabled = true;
	return fetch(`/api/settings/send_batch_email`, {
		credentials: "same-origin",
		method: "POST",
		body: content
	}).then(checkStatus).then(parseJSON).then((result: {success: boolean; count: number} ) => {
		sendEmailButton.disabled = false;
		sweetAlert("Success!", `Successfully sent ${result.count} email(s)!`, "success");
	});
});
