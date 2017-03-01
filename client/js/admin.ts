/// <reference path="../../node_modules/@types/qwest/index.d.ts" />
/// <reference path="../../node_modules/sweetalert2/sweetalert2.d.ts" />
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
    let urlState = states.find(state => state.id === window.location.hash.substr(1));
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
	settingsUpdateButton.disabled = true;
    
	qwest.put("/api/settings/application_availability", {
        "open": parseDateTime((document.getElementById("application-open") as HTMLInputElement).value).toISOString(),
        "close": parseDateTime((document.getElementById("application-close") as HTMLInputElement).value).toISOString()
    }).then(() => {
        return qwest.put("/api/settings/teams_enabled", {
            "enabled": (document.getElementById("teams-enabled") as HTMLInputElement).checked ? "true" : "false"
        });
    }).then(async () => {
		await sweetAlert("Awesome!", "Settings successfully updated.", "success");
        window.location.reload();
	}).catch((err: Error, xhr: any, response: any) => {
		sweetAlert("Oh no!", response.error, "error");
	}).complete(() => {
		settingsUpdateButton.disabled = false;
	});
});
