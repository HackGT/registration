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
