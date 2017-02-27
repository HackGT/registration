/// <reference path="../../node_modules/@types/qwest/index.d.ts" />
/// <reference path="../../node_modules/sweetalert2/sweetalert2.d.ts" />
declare let sweetAlert: any; // FUCK IT SHIP IT (sweetalert's type declaration file isn't working for some reason)

let form = document.querySelector("form")!;
let submitButton = document.querySelector("form input[type=submit]")! as HTMLInputElement;
submitButton.addEventListener("click", e => {
	if (!form.checkValidity() || !form.dataset["action"]) {
		return;
	}
	submitButton.disabled = true;

	qwest.post(form.dataset["action"]!, 
		new FormData(form)
	).then(async () => {
		await sweetAlert("Awesome!", "Your application has been saved. Feel free to come back here and edit it at any time.", "success");
		window.location.assign("/");
	}).catch((err: Error, xhr: any, response: any) => {
		sweetAlert("Oh no!", response.error, "error");
	}).complete(() => {
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
		qwest.delete(deleteButton.dataset["action"]!).then(async () => {
			window.location.assign("/apply");
		}).catch((err: Error, xhr: any, response: any) => {
			sweetAlert("Oh no!", response.error, "error");
		}).complete(() => {
			deleteButton!.disabled = false;
		});
	});
}
