const joinTeamButton = document.getElementById('joinTeam');
const joinTeamInput = document.getElementById('joinTeamInput') as HTMLInputElement;
const createTeamButton = document.getElementById('createTeam');
const leaveTeamButton = document.getElementById('leaveTeam');

joinTeamButton && joinTeamButton.addEventListener("click", e => {
    e.preventDefault();

    fetch(joinTeamButton!.getAttribute('action')! + "/" + joinTeamInput!.value, {
        credentials: "same-origin",
        method: "POST",
    }).then(checkStatus).then(parseJSON).then(async () => {
        await sweetAlert("Awesome!", "You successfully joined your new team.", "success");
        window.location.assign("/team");
    }).catch(async (err: Error) => {
        await sweetAlert("Oh no!", err.message, "error");
        submitButton.disabled = false;
    });

});

leaveTeamButton && leaveTeamButton.addEventListener("click", e => {
    e.preventDefault();

    fetch(leaveTeamButton!.getAttribute('action')!, {
        credentials: "same-origin",
        method: "POST"
    }).then(checkStatus).then(parseJSON).then(async () => {
        await sweetAlert("Bye!", "You successfully left your team.", "success");
        window.location.assign("/team");
    }).catch(async (err: Error) => {
        await sweetAlert("Oh no!", err.message, "error");
        submitButton.disabled = false;
    });

});

createTeamButton && createTeamButton.addEventListener("click", e => {
    e.preventDefault();

    fetch(createTeamButton!.getAttribute('action')!, {
        credentials: "same-origin",
        method: "POST"
    }).then(checkStatus).then(parseJSON).then(async () => {
        await sweetAlert("Nice!", "You successfully created a team.", "success");
        window.location.assign("/team");
    }).catch(async (err: Error) => {
        await sweetAlert("Oh no!", err.message, "error");
        submitButton.disabled = false;
    });

});
