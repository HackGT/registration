import {
	StatisticEntry, ResponseCount
} from "../../server/schema";

import * as d3 from "d3";

function drawBarGraph(statistics: StatisticEntry | null, divId: string) {
	if (statistics === null) {
		return;
	}
	let height = Math.max(window.innerHeight / 3, 200);
	let width = (document.getElementById("statistics") as HTMLElement).getBoundingClientRect().width;

	let data: ResponseCount[] = statistics.responses;

	const margin = {
		top: 20,
		side: 40,
		bottom: 80
	};

	let x = d3.scale.ordinal()
		.rangeRoundBands([0, width], 0.1, 0.3);

	let y = d3.scale.linear()
		.range([height, 0]);

	let xAxis = d3.svg.axis()
		.scale(x)
		.orient("bottom");

	let yAxis = d3.svg.axis()
		.scale(y)
		.orient("left")
		.tickFormat(d3.format("d"))
		.ticks(d3.max(data, d => d.count));

	let svg = d3.select("#" + divId).append("svg")
		.attr("width", width)
		.attr("height", height + margin.top + margin.bottom)
		.append("g")
		.attr("transform", `translate(${margin.side}, ${margin.top})`);

	x.domain(data.map( d => d.response));
	y.domain([0, d3.max(data, d => d.count)]);

	svg.append("g")
		.attr("class", "x axis")
		.attr("transform", `translate(0, ${height})`)
		.call(xAxis)
		.selectAll(".tick text")
		.call(wrap, x.rangeBand());

	svg.append("g")
		.attr("class", "y axis")
		.call(yAxis);

	svg.selectAll(".bar")
		.data(data)
		.enter().append("rect")
		.attr("class", "bar")
		.attr("x", d => x(d.response))
		.attr("width", x.rangeBand())
		.attr("y", d => y(d.count))
		.attr("height", d => height - y(d.count));
}
// Makes --noUnusedLocals switch for TypeScript happy (this function is called from embedded JS in admin.html and therefore TypeScript doesn't know it's being used)
drawBarGraph(null, "");

function wrap(textEl: any, width: number) {
	textEl.each(function() {
		// tslint:disable-next-line:no-invalid-this
		let text = d3.select(this);
		let words = text.text().split(/\s+/).reverse();
		let word;
		let line: string[] = [];
		let lineNumber = 0;
		let lineHeight = 1.1; // Unit: em
		let y = text.attr("y");
		let dy = parseFloat(text.attr("dy"));
		let tspan: any = text.text(null!).append("tspan").attr("x", 0).attr("y", y).attr("dy", dy.toString() + "em");

		// tslint:disable-next-line:no-conditional-assignment
		while (word = words.pop()) {
			line.push(word);
			tspan.text(line.join(" "));
			if (tspan.node().getComputedTextLength() > width) {
				line.pop();
				tspan.text(line.join(" "));
				line = [word];
				tspan = text.append("tspan").attr("x", 0).attr("y", y).attr("dy", `${++lineNumber * lineHeight + dy} em`).text(word);
			}
		}
	});
}
