class State {
    public id: string;
    private sectionElement: HTMLElement;

    static hideAll() {
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
    hide(): void {
        this.sectionElement.style.display = "none";
    }
    show(hideAll: boolean = true): void {
        if (hideAll) State.hideAll();
        this.sectionElement.style.display = "block";
    }
}

const states: State[] = ["statistics", "users", "settings"].map(id => new State(id));

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
readURLHash();
// Load the correct state on button press
window.addEventListener("hashchange", readURLHash);

// Settings update
function parseDateTime (dateTime: string) {
    let digits = dateTime.split(/\D+/).map(num => parseInt(num));
    return new Date(digits[0], digits[1] - 1, digits[2], digits[3], digits[4], digits[5] || 0, digits[6] || 0);
}
let settingsUpdateButton = document.querySelector("#settings input[type=submit]") as HTMLInputElement;
let settingsForm = document.querySelector("#settings form") as HTMLFormElement;
settingsUpdateButton.addEventListener("click", e => {
    if (!settingsForm.checkValidity() || !settingsForm.dataset["action"]) {
		return;
	}
    e.preventDefault();
	settingsUpdateButton.disabled = true;

    fetch("/api/settings/application_availability", {
		credentials: "same-origin",
		method: "PUT",
		body: JSON.stringify({
            "open": parseDateTime((document.getElementById("application-open") as HTMLInputElement).value).toISOString(),
            "close": parseDateTime((document.getElementById("application-close") as HTMLInputElement).value).toISOString()
        })
	}).then(checkStatus).then(parseJSON).then(() => {
		return fetch("/api/settings/teams_enabled", {
            credentials: "same-origin",
            method: "PUT",
            body: JSON.stringify({
                "enabled": (document.getElementById("teams-enabled") as HTMLInputElement).checked ? "true" : "false"
            })
        });
    }).then(checkStatus).then(parseJSON).then(async () => {
        await sweetAlert("Awesome!", "Settings successfully updated.", "success");
        window.location.reload();
	}).catch(async (err: Error) => {
		await sweetAlert("Oh no!", err.message, "error");
		submitButton.disabled = false;
	});
});
