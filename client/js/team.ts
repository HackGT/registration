const joinTeamButton = document.getElementById("joinTeam") as HTMLInputElement;
const joinTeamInput = document.getElementById("joinTeamInput") as HTMLInputElement;
const createTeamButton = document.getElementById("createTeam") as HTMLInputElement;
const teamNameButton = document.getElementById("teamNameInput") as HTMLInputElement;
const leaveTeamButton = document.getElementById("leaveTeam") as HTMLInputElement;

joinTeamButton && joinTeamButton.addEventListener("click", e => {
    e.preventDefault();

    if (joinTeamInput.value === "") {
        return sweetAlert("Whoops!", "Please enter a team name!", "error");
    }

    fetch(joinTeamButton.getAttribute("action") + encodeURI(joinTeamInput.value), {
        credentials: "same-origin",
        method: "POST",
    }).then(checkStatus).then(parseJSON).then(async () => {
        await sweetAlert("Awesome!", "You successfully joined your new team.", "success");
        window.location.assign("/team");
    }).catch(async (err: Error) => {
        await sweetAlert("Oh no!", "No such team", "error");
    });

});

leaveTeamButton && leaveTeamButton.addEventListener("click", e => {
    e.preventDefault();

    fetch(leaveTeamButton.getAttribute("action")!, {
        credentials: "same-origin",
        method: "POST"
    }).then(checkStatus).then(parseJSON).then(async () => {
        await sweetAlert("Bye!", "You successfully left your team.", "success");
        window.location.assign("/team");
    }).catch(async (err: Error) => {
        await sweetAlert("Oh no!", "Can't leave team", "error");
    });

});

createTeamButton && createTeamButton.addEventListener("click", e => {
    e.preventDefault();

    if (teamNameButton.value === "") {
        return sweetAlert("Whoops!", "Please enter a team name!", "error");
    }

    fetch(createTeamButton.getAttribute("action") + encodeURI(teamNameButton.value), {
        credentials: "same-origin",
        method: "POST"
    }).then(checkStatus).then(parseJSON).then(async () => {
        await sweetAlert("Nice!", "You successfully created a team.", "success");
        window.location.assign("/team");
    }).catch(async (err: Error) => {
        console.log(err)
        await sweetAlert("Oh no!", "A team with this name already exists!", "error");
    });

});
