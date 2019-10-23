enum FormType {
	Application,
	Confirmation
}
const formTypeString = document.body.dataset.formType as keyof typeof FormType;
const formType = FormType[formTypeString];
const unauthenticated = document.body.dataset.unauthenticated === "true";

let form = document.querySelector("form") as HTMLFormElement | null;
let submitButton = document.querySelector("form input[type=submit]") as HTMLInputElement;
submitButton.addEventListener("click", e => {
	if (!form || !form.checkValidity() || !form.dataset.action) {
		return;
	}
	e.preventDefault();
	submitButton.disabled = true;

	fetch(form.dataset.action!, {
		credentials: "same-origin",
		method: "POST",
		body: new FormData(form)
	}).then(checkStatus).then(parseJSON).then(async (json) => {
		if (unauthenticated) {
			let qr = qrcode(0, "H");
			qr.addData(json.uuid);
			qr.make();

			await sweetAlert({
				type: "success",
				title: "Awesome!",
				html: `Scan this code to create badge: <br>${qr.createImgTag(8,4)}`
			});
		} else {
			let successMessage: string = formType === FormType.Application ? "Your application has been saved." : "Your RSVP has been saved.";
			successMessage += " Feel free to come back here and edit it at any time.";
			await sweetAlert("Awesome!", successMessage, "success");
		}

		if (unauthenticated) {
			document.querySelector("form")!.reset();
			submitButton.disabled = false;
			window.scrollTo(0, 0);
		} else {
			window.location.assign("/");
		}
	}).catch(async (err: Error) => {
		await sweetAlert("Oh no!", err.message, "error");
		submitButton.disabled = false;
	});
});

let deleteButton = document.querySelector("#delete") as HTMLButtonElement | null;
if (deleteButton) {
	deleteButton.addEventListener("click", async e => {
		e.preventDefault();
		if (!deleteButton || !form || !form.dataset.action) {
			return;
		}
		deleteButton.disabled = true;

		try {
			let confirmMessage: string = formType === FormType.Application ?
				"This will allow you to submit a different application type but your current data will be lost forever." :
				"Your current data will be lost forever and we'll mark you as not attending. You can still RSVP again if you change your mind.";

			await sweetAlert({
				title: "Are you sure?",
				text: confirmMessage,
				type: "warning",
				confirmButtonColor: "#FF4136",
				confirmButtonText: "Delete",
				showCancelButton: true
			});
		}
		catch (err) {
			// Delete canceled
			deleteButton.disabled = false;
			return;
		}

		fetch(form.dataset.action!, {
			credentials: "same-origin",
			method: "DELETE"
		}).then(checkStatus).then(parseJSON).then(async () => {
			window.location.assign("/");
		}).catch(async (err: Error) => {
			await sweetAlert("Oh no!", err.message, "error");
			submitButton.disabled = false;
		});
	});
}

let selectsWithOther = document.querySelectorAll(`[data-hasother-select="true"]`) as NodeListOf<HTMLSelectElement>;
let inputsWithOther = document.querySelectorAll(`[data-hasother-fieldset="true"] input:not([type="text"])`) as NodeListOf<HTMLInputElement>;
for (let i = 0; i < selectsWithOther.length; i++) {
	selectsWithOther[i].addEventListener("change", e => {
		let target = e.target as HTMLSelectElement;
		let otherField = document.querySelector(`input[name="${target.name}"]`) as HTMLInputElement | null;
		if (!otherField) {
			return;
		}
		if (target.value === "Other") {
			otherField.disabled = false;
			otherField.focus();
		}
		else {
			otherField.disabled = true;
		}
	});
}
for (let i = 0; i < inputsWithOther.length; i++) {
	inputsWithOther[i].addEventListener("change", e => {
		let target = e.target as HTMLInputElement;
		let otherField = ((target.parentElement as HTMLDivElement).parentElement as HTMLFieldSetElement).querySelector(`input[type="text"]`) as HTMLInputElement | null;
		if (!otherField) {
			return;
		}
		if (target.type === "radio") {
			if (target.value === "Other") {
				otherField.disabled = false;
				otherField.focus();
			}
			else {
				otherField.disabled = true;
			}
		}
		else if (target.type === "checkbox") {
			if (target.value === "Other" && target.checked) {
				otherField.disabled = false;
				otherField.focus();
			}
			else if (target.value === "Other" && !target.checked) {
				otherField.disabled = true;
			}
		}
	});
}

let wordCountInputs = document.querySelectorAll("[data-max-word-count], [data-min-word-count]") as NodeListOf<HTMLInputElement | HTMLTextAreaElement>;
for (let i = 0; i < wordCountInputs.length; i++) {
	wordCountInputs[i].addEventListener("input", e => {
		const target = e.target as HTMLInputElement | HTMLTextAreaElement;
		const correspondingLabel = document.querySelector(`label[for="${target.id}"] > .current-count`);
		if (!correspondingLabel) { return; }

		const { maxWordCount, minWordCount } = target.dataset;
		if (!maxWordCount && !minWordCount) { return; }

		let wordCount = target.value.trim().split(/\s+/).length;
		if (target.value.trim().length === 0) {
			wordCount = 0;
		}
		correspondingLabel.textContent = `(${wordCount.toLocaleString()} word${wordCount === 1 ? "" : "s"})`;
	});
}
