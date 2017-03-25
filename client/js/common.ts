declare const sweetAlert: any;

// Fetch helper functions
async function checkStatus(response: Response) {
	if (response.status >= 200 && response.status < 300) {
		return response;
	}
	else {
		return new Error((await response.json()).error);
	}
}
function parseJSON(response: Response) {
	return response.json()
}
