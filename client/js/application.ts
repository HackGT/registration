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
	}).then(checkStatus).then(parseJSON).then(async () => {
		let successMessage: string = window.location.pathname.match(/^\/apply/) ?
			"Your application has been saved. Feel free to come back here and edit it at any time." :
			"Your RSVP has been saved. Feel free to come back here and edit it at any time. We look forward to seeing you!";

		await sweetAlert("Awesome!", successMessage, "success");
		window.location.assign("/");
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
			let confirmMessage: string = window.location.pathname.match(/^\/apply/) ?
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
			window.location.assign("/apply");
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
