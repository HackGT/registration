//
// Agenda Async Queue
//
import * as Agenda from "agenda";
import * as sendgrid from "@sendgrid/mail";
import { config, renderEmailHTML, renderEmailText } from "../common";
import { User } from "../schema";

export const agenda = new Agenda({ db: { address: config.server.mongoURL } });

agenda.define("send_templated_email", async (job, done) => {
  try {
    let user = await User.findOne({ uuid: job.attrs.data.id });
    if (user) {
      let emailHTML = await renderEmailHTML(job.attrs.data.markdown, user);
      let emailText = await renderEmailText(job.attrs.data.markdown, user);
      let emailDetails = {
        from: config.email.from,
        to: user.email,
        subject: job.attrs.data.subject,
        html: emailHTML,
        text: emailText,
      };
      await sendgrid.send(emailDetails);
      await done();
    } else {
      await done(new Error("No such user"));
    }
  } catch (err) {
    console.error(err);
    await done(err);
  }
});

agenda.start().catch((err) => {
  console.error("Unable to start agenda worker: ", err);
});
