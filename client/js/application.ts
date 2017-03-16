declare const sweetAlert: any;
declare const axios: any;

let form = document.querySelector("form")!;
let submitButton = document.querySelector("form input[type=submit]")! as HTMLInputElement;
submitButton.addEventListener("click", e => {
	if (!form.checkValidity() || !form.dataset["action"]) {
		return;
	}
	e.preventDefault();
	submitButton.disabled = true;

	axios.post(form.dataset["action"]!,
		new FormData(form)
	).then(async () => {
		await sweetAlert("Awesome!", "Your application has been saved. Feel free to come back here and edit it at any time.", "success");
		submitButton.disabled = false;
		window.location.assign("/");
	}).catch(async (err: any) => {
		let errorText: string;
		if (err.response) {
			errorText = err.response.data.error;
		}
		else {
			errorText = err.message;
		}
		await sweetAlert("Oh no!", errorText, "error");
		submitButton.disabled = false;
	});
});

let deleteButton = document.querySelector("#delete") as HTMLButtonElement | null;
if (deleteButton) {
	deleteButton.addEventListener("click", async e => {
		e.preventDefault();
		if (!deleteButton || !deleteButton.dataset["action"]) return;
		deleteButton.disabled = true;
		try {
			await sweetAlert({
				title: "Are you sure?",
				text: "This will allow you to submit a different application type but your current data will be lost forever.",
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
		axios.delete(
			deleteButton.dataset["action"]!
		).then(async () => {
			submitButton.disabled = false;
			window.location.assign("/apply");
		}).catch(async (err: any) => {
			let errorText: string;
			if (err.response) {
				errorText = err.response.data.error;
			}
			else {
				errorText = err.message;
			}
			await sweetAlert("Oh no!", errorText, "error");
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
		if (!otherField) return;
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
		let otherField = (<HTMLFieldSetElement> (<HTMLDivElement> target.parentElement).parentElement).querySelector(`input[type="text"]`) as HTMLInputElement | null;
		if (!otherField) return;
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
