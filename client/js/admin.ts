/// <reference path="application.ts" />

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

const states: State[] = ["statistics", "users", "settings", "applicants"].map(id => new State(id));

// async function checkStatus(response: Response) {
//     if (response.status >= 200 && response.status < 300) {
//         return response;
//     }
//     else {
//         return new Error((await response.json()).error);
//     }
// }
// function parseJSON(response: Response) {
//     return response.json()
// }

// declare const sweetAlert: any;


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

// Load timezone-correct values for the application open / close time
let timeInputs = document.querySelectorAll('input[type="datetime-local"]') as NodeListOf<HTMLInputElement>;
for (let i = 0; i < timeInputs.length; i++) {
    timeInputs[i].value = moment(new Date(timeInputs[i].dataset.rawValue || "")).format("Y-MM-DDTHH:mm:00");
}

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

    let applicationAvailabilityData = new FormData();
    applicationAvailabilityData.append("open", parseDateTime((document.getElementById("application-open") as HTMLInputElement).value).toISOString());
    applicationAvailabilityData.append("close", parseDateTime((document.getElementById("application-close") as HTMLInputElement).value).toISOString());
    let teamsEnabledData = new FormData();
    teamsEnabledData.append("enabled", (document.getElementById("teams-enabled") as HTMLInputElement).checked ? "true" : "false");

    fetch("/api/settings/application_availability", {
		credentials: "same-origin",
		method: "PUT",
		body: applicationAvailabilityData
	}).then(checkStatus).then(parseJSON).then(() => {
		return fetch("/api/settings/teams_enabled", {
            credentials: "same-origin",
            method: "PUT",
            body: teamsEnabledData
        });
    }).then(checkStatus).then(parseJSON).then(async () => {
        await sweetAlert("Awesome!", "Settings successfully updated.", "success");
        window.location.reload();
	}).catch(async (err: Error) => {
		await sweetAlert("Oh no!", err.message, "error");
		settingsUpdateButton.disabled = false;
	});
});


let applicationStatusUpdateButtons = document.querySelectorAll(".statusButton");

for (let i = 0; i < applicationStatusUpdateButtons.length; i++) {

    let statusUpdateButton = applicationStatusUpdateButtons[i] as HTMLInputElement;
    console.log("Hurray");

    statusUpdateButton.addEventListener("click", e => {
        
        var eventTarget = e.target as HTMLInputElement;
        console.log(eventTarget.id);

        e.preventDefault();
        eventTarget.disabled = true;

        let adminId = eventTarget.getAttribute('data-admin');
        let userId = eventTarget.getAttribute('data-user');
        let currentCondition = eventTarget.getAttribute('data-accepted') === "true";

        var formData = new FormData();
        formData.append("id", userId);
        formData.append("status", !currentCondition);

        fetch("/api/user/" + adminId + "/status/", {
            credentials: "same-origin",
            method: "POST",
            body: formData
        }).then(checkStatus).then(parseJSON).then(async () => {
            await sweetAlert("Awesome!", "Settings successfully updated.", "success");
            window.location.reload();
        }).catch(async (err: Error) => {
            await sweetAlert("Oh no!", err.message, "error");
            eventTarget.disabled = false;
        });
    });   
}