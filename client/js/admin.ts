class State {
	public id: string;
	private sectionElement: HTMLElement;

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
const states: State[] = ["statistics", "users", "applicants", "settings"].map(id => new State(id));

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

		let query: { [index: string]: any } = {
			offset: this.offset,
			count: this.NODE_COUNT
		};
		let params = Object.keys(query)
			.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
			.join("&")
			.replace(/%20/g, "+");
		fetch(`/api/admin/users?${params}`, {
			credentials: "same-origin",
			method: "GET"
		}).then(checkStatus).then(parseJSON).then((response: {
			offset: number;
			count: number;
			total: number;
			data: any[];
		}) => {
			for (let i = 0; i < this.NODE_COUNT; i++) {
				let node = this.nodes[i];
				let user = response.data[i];

				if (user) {
					node.style.display = "table-row";
					node.querySelector("td.name")!.textContent = user.name;
					node.querySelector("td.email > span")!.textContent = user.email;
					node.querySelector("td.email")!.classList.remove("verified", "notverified", "admin");
					if (user.verifiedEmail) {
						node.querySelector("td.email")!.classList.add("verified");
					}
					else {
						node.querySelector("td.email")!.classList.add("notverified");
					}
					if (user.admin) {
						node.querySelector("td.email")!.classList.add("admin");
					}
					node.querySelector("td.status")!.textContent = user.status;
					node.querySelector("td.login-method")!.textContent = user.loginMethods;
				}
				else {
					node.style.display = "none";
				}
			}

			if (response.offset <= 0) {
				this.previousButton.disabled = true;
			}
			else {
				this.previousButton.disabled = false;
			}
			let upperBound = response.offset + response.count;
			if (upperBound >= response.total) {
				upperBound = response.total;
				this.nextButton.disabled = true;
			}
			else {
				this.nextButton.disabled = false;
			}
			let lowerBound = response.offset + 1;
			if (response.data.length <= 0) {
				lowerBound = 0;
			}
			status.textContent = `${lowerBound} – ${upperBound} of ${response.total.toLocaleString()}`;
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
	private static readonly NODE_COUNT = 100;
	private static generalNodes: HTMLTableRowElement[] = [];
	private static detailsNodes: HTMLTableRowElement[] = [];
	private static offset: number = 0;
	private static readonly previousButton = document.getElementById("applicants-entries-previous") as HTMLButtonElement;
	private static readonly nextButton = document.getElementById("applicants-entries-next") as HTMLButtonElement;
	private static readonly branchFilter = document.getElementById("branch-filter") as HTMLInputElement;
	private static readonly statusFilter = document.getElementById("status-filter") as HTMLInputElement;
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
			this.filter.branch = this.branchFilter.value;
		}
		if (this.statusFilter.value !== "*") {
			this.filter.status = this.statusFilter.value;
		}
		this.offset = 0;
		this.load();
	}
	public static load() {
		const status = document.getElementById("applicants-entries-status") as HTMLParagraphElement;
		status.textContent = "Loading...";

		let query: { [index: string]: any } = {
			offset: this.offset,
			count: this.NODE_COUNT,
			applied: true,
			...this.filter
		};
		let params = Object.keys(query)
			.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
			.join("&")
			.replace(/%20/g, "+");
		fetch(`/api/admin/users?${params}`, {
			credentials: "same-origin",
			method: "GET"
		}).then(checkStatus).then(parseJSON).then((response: {
			offset: number;
			count: number;
			total: number;
			data: any[];
		}) => {
			for (let i = 0; i < this.NODE_COUNT; i++) {
				let generalNode = this.generalNodes[i];
				let detailsNode = this.detailsNodes[i];
				let user = response.data[i];

				if (user) {
					generalNode.style.display = "table-row";
					detailsNode.style.display = "table-row";

					generalNode.dataset.id = user._id;
					generalNode.querySelector("td.name")!.textContent = user.name;
					generalNode.querySelector("td.team")!.textContent = "";
					if (user.teamName) {
						let teamContainer = document.createElement("b");
						teamContainer.textContent = user.teamName;
						generalNode.querySelector("td.team")!.appendChild(teamContainer);
					}
					else {
						generalNode.querySelector("td.team")!.textContent = "No Team";
					}
					generalNode.querySelector("td.email > span")!.textContent = user.email;
					generalNode.querySelector("td.email")!.classList.remove("verified", "notverified", "admin");
					if (user.verifiedEmail) {
						generalNode.querySelector("td.email")!.classList.add("verified");
					}
					else {
						generalNode.querySelector("td.email")!.classList.add("notverified");
					}
					if (user.admin) {
						generalNode.querySelector("td.email")!.classList.add("admin");
					}
					generalNode.querySelector("td.branch")!.textContent = user.applicationBranch;
					let statusSelect = generalNode.querySelector("select.status") as HTMLSelectElement;
					statusSelect.value = user.accepted ? "accepted" : "no-decision";

					let dataSection = detailsNode.querySelector("div.applicantData") as HTMLDivElement;
					while (dataSection.hasChildNodes()) {
						dataSection.removeChild(dataSection.lastChild!);
					}
					for (let answer of user.applicationDataFormatted as { label: string; value: string; filename?: string }[]) {
						let row = document.createElement("p");
						let label = document.createElement("b");
						label.innerHTML = answer.label;
						row.appendChild(label);
						row.appendChild(document.createTextNode(` → ${answer.value}`));
						if (answer.filename) {
							row.appendChild(document.createTextNode(" ("));
							let link = document.createElement("a");
							link.setAttribute("href", `/uploads/${answer.filename}`);
							link.textContent = "Download";
							row.appendChild(link);
							row.appendChild(document.createTextNode(")"));
						}
						dataSection.appendChild(row);
					}
				}
				else {
					generalNode.style.display = "none";
					detailsNode.style.display = "none";
				}
			}

			if (response.offset <= 0) {
				this.previousButton.disabled = true;
			}
			else {
				this.previousButton.disabled = false;
			}
			let upperBound = response.offset + response.count;
			if (upperBound >= response.total) {
				upperBound = response.total;
				this.nextButton.disabled = true;
			}
			else {
				this.nextButton.disabled = false;
			}
			let lowerBound = response.offset + 1;
			if (response.data.length <= 0) {
				lowerBound = 0;
			}
			status.textContent = `${lowerBound} – ${upperBound} of ${response.total.toLocaleString()}`;
		}).catch(async err => {
			console.error(err);
			await sweetAlert("Oh no!", err.message, "error");
		});
	}

	public static setup() {
		this.generalNodes = [];
		this.instantiate();
		this.offset = 0;
		this.load();
		this.previousButton.addEventListener("click", () => {
			this.previous();
		});
		this.nextButton.addEventListener("click", () => {
			this.next();
		});
		this.branchFilter.addEventListener("change", e => {
			this.updateFilter();
		});
		this.statusFilter.addEventListener("change", e => {
			this.updateFilter();
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
declare let SimpleMDE: any;

const emailTypeSelect = document.getElementById("email-type") as HTMLSelectElement;
let emailRenderedArea: HTMLElement | ShadowRoot = document.getElementById("email-rendered") as HTMLElement;
if (document.head.attachShadow) {
	// Browser supports Shadow DOM
	emailRenderedArea = emailRenderedArea.attachShadow({ mode: "open" });
}
const markdownEditor = new SimpleMDE({ element: document.getElementById("email-content")! });
let contentChanged = false;
let lastSelected = emailTypeSelect.value;

markdownEditor.codemirror.on("change", async () => {
	contentChanged = true;
	try {
		let content = new FormData();
		content.append("content", markdownEditor.value());

		let { html, text }: { html: string; text: string } = (
			await fetch(`/api/settings/email_content/${emailTypeSelect.value}/rendered`, {
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
});

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
		let content = (await fetch(`/api/settings/email_content/${emailTypeSelect.value}`, { credentials: "same-origin" }).then(checkStatus).then(parseJSON)).content as string;
		markdownEditor.value(content);
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
function parseDateTime(dateTime: string) {
	let digits = dateTime.split(/\D+/).map(num => parseInt(num, 10));
	return new Date(digits[0], digits[1] - 1, digits[2], digits[3], digits[4], digits[5] || 0, digits[6] || 0);
}
let settingsUpdateButton = document.querySelector("#settings input[type=submit]") as HTMLInputElement;
let settingsForm = document.querySelector("#settings form") as HTMLFormElement;
settingsUpdateButton.addEventListener("click", e => {
	if (!settingsForm.checkValidity() || !settingsForm.dataset.action) {
		return;
	}
	e.preventDefault();
	settingsUpdateButton.disabled = true;

	let teamsEnabledData = new FormData();
	teamsEnabledData.append("enabled", (document.getElementById("teams-enabled") as HTMLInputElement).checked ? "true" : "false");

	let qrEnabledData = new FormData();
	qrEnabledData.append("enabled", (document.getElementById("qr-enabled") as HTMLInputElement).checked ? "true" : "false");

	let branchRoleData = new FormData();
	let branchRoles = document.querySelectorAll("div.branch-role") as NodeListOf<HTMLDivElement>;
	for (let i = 0; i < branchRoles.length; i++) {
		let branchName = branchRoles[i].dataset.name!;
		let branchRole = branchRoles[i].querySelector("select")!.value;
		let branchData: {
				role: string;
				open?: Date;
				close?: Date;
				usesRollingDeadline?: boolean;
				confirmationBranches?: string[];
		} = {role: branchRole};
		// TODO this should probably be typed (not just strings)
		if (branchRole !== "Noop") {
				let openInputElem = branchRoles[i].querySelector("input.openTime") as HTMLInputElement;
				let closeInputElem = branchRoles[i].querySelector("input.closeTime") as HTMLInputElement;
				branchData.open = openInputElem ? new Date(openInputElem.value) : new Date();
				branchData.close = closeInputElem ? new Date(closeInputElem.value) : new Date();
		}
		if (branchRole === "Application") {
			let checkboxes = branchRoles[i].querySelectorAll("fieldset.availableConfirmationBranches input") as NodeListOf<HTMLInputElement>;
			let allowedConfirmationBranches: string[] = [];
			for (let j = 0; j < checkboxes.length; j++) {
				if (checkboxes[j].checked) {
					allowedConfirmationBranches.push(checkboxes[j].dataset.confirmation!);
				}
			}
			branchData.confirmationBranches = allowedConfirmationBranches;
		}
		if (branchRole === "Confirmation") {
			let usesRollingDeadlineCheckbox = (branchRoles[i].querySelectorAll("input.usesRollingDeadline") as NodeListOf<HTMLInputElement>);
			branchData.usesRollingDeadline = usesRollingDeadlineCheckbox.length > 0 ? usesRollingDeadlineCheckbox[0].checked : false;
		}
		branchRoleData.append(branchName, JSON.stringify(branchData));
	}

	let emailContentData = new FormData();
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
		return fetch("/api/settings/branch_roles", {
			...defaultOptions,
			body: branchRoleData
		});
	}).then(checkStatus).then(parseJSON).then(() => {
		if (emailTypeSelect.value) {
			return fetch(`/api/settings/email_content/${emailTypeSelect.value}`, {
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
		settingsUpdateButton.disabled = false;
	});
});

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
const header = document.querySelector("#sidebar > h1") as HTMLHeadingElement;
const color = window.getComputedStyle(header).getPropertyValue("color");

for (let i = 0; i < data.length; i++) {
	let context = document.getElementById(`chart-${i}`) as HTMLCanvasElement | null;
	if (!context) {
		console.warn(`Canvas with ID "chart-${i}" does not exist`);
		continue;
	}

	new Chart(context, {
		"type": "bar",
		"data": {
			"labels": data[i].responses.map(response => response.response),
			"datasets": [{
				"label": data[i].questionName,
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
						"callback": (value: number) => value % 1 === 0 ? value : undefined // Only integers
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
						"autoSkip": false
					},
					"gridLines": {
						"zeroLineColor": color
					}
				}]
			}
		}
	});
}
