import * as fs from "fs";
import * as path from "path";
import * as express from "express";
import * as Handlebars from "handlebars";
var config = require("../../questions.json");

import {
	STATIC_ROOT,
	authenticateWithReject,
	authenticateWithRedirect
} from "../common";
import {
	IUser, IUserMongoose, User,
	IIndexTemplate, ILoginTemplate, 
	IRegisterTemplate
} from "../schema";

export let templateRoutes = express.Router();

// Load and compile Handlebars templates
let [indexTemplate, loginTemplate, registerTemplate] = ["index.html", "login.html", "register.html"].map(file => {
	let data = fs.readFileSync(path.resolve(STATIC_ROOT, file), "utf8");
	return Handlebars.compile(data);
});

templateRoutes.route("/").get(authenticateWithRedirect, (request, response) => {
	let templateData: IIndexTemplate = {
		siteTitle: "HackGT High School"
	};
	response.send(indexTemplate(templateData));
});

templateRoutes.route("/login").get((request, response) => {
	let templateData: ILoginTemplate = {
		siteTitle: "HackGT High School"
	};
	response.send(loginTemplate(templateData));
});



templateRoutes.route("/register").get((request, response) => {
	let templateData: IRegisterTemplate = {
				obtainTemp: function getFormData() {
					var listTypes:Array<any> =[];
		            var i = 0;
		            var j = 0
		            for (i = 0; i < config.length; i++) {
		                if (config[i].type === "radio") {
		                    var htmlText = "<br>";
		                    for (j = 0; j < config[i].options.length; j++) {
		                        console.log(config[i].options[j]);
		                        htmlText = htmlText 
		                                    + "<input type=\"radio\" name=\"" 
		                                    + config[i].name 
		                                    + "\" value=\"" 
		                                    + config[i].options[j] 
		                                    + "\">" 
		                                    + config[i].options[j] 
		                                    + "<br>";
		                    }
		                    
		                    listTypes[listTypes.length] = {html: htmlText, title: config[i].question_text};
		                } else if (config[i].type === "checkbox") {
		                    var htmlText = "<br>";
		                    for (j = 0; j < config[i].options.length; j++) {
		                        console.log(config[i].options[j]);
		                        htmlText = htmlText 
		                                    + "<input type=\"checkbox\" name=\"" 
		                                    + config[i].options[j].name 
		                                    + "\" value=\"" 
		                                    + config[i].options[j].value 
		                                    + "\">" 
		                                    + config[i].options[j].text 
		                                    + "<br>";
		                    }
		                    
		                    listTypes[listTypes.length] = {html: htmlText, 
		                                                    title: config[i].question_text};
		                } else {
		                    listTypes[listTypes.length] = {html: "<input type=\"" 
		                                                            + config[i].type 
		                                                            + "\">", 
		                                                            title: config[i].question_text};
		                }
		                
		                
		            }
		            
		            return listTypes; 
		}
	};
	response.send(registerTemplate(templateData));
});