import {
	StatisticEntry, ResponseCount
} from "../../server/schema";

import * as d3 from "d3";


function drawBarGraph(statistics: StatisticEntry, divId: string) {
	let height = Math.max(window.innerHeight / 3, 200	);
	let width = window.innerWidth / 2;

	let data: ResponseCount[] = (statistics.responses)!;

	let margin = {
	    top: 20,
	    right: 40,
	    bottom: 80,
	    left: 40
	};

	let x = d3.scale.ordinal()
	    .rangeRoundBands([0, width], .1, .3);

	let y = d3.scale.linear()
	    .range([height, 0]);

	let xAxis = d3.svg.axis()
	    .scale(x)
	    .orient("bottom");

	let yAxis = d3.svg.axis()
	    .scale(y)
	    .orient("left")
	    .tickFormat(d3.format("d"))
	    .ticks(d3.max(data, function(d: ResponseCount) {
	        return d.count;
	    }));

	let svg = d3.select("#" + divId).append("svg")
	    .attr("width", width + margin.left + margin.right)
	    .attr("height", height + margin.top + margin.bottom)
	    .append("g")
	    .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

	x.domain(data.map(function(d) {
	    return d.response;
	}));
	y.domain([0, d3.max(data, function(d: ResponseCount) {
	    return d.count;
	})]);

	svg.append("g")
	    .attr("class", "x axis")
	    .attr("transform", "translate(0," + height + ")")
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
	    .attr("x", function(d: ResponseCount) {
	        return x(d.response);
	    })
	    .attr("width", x.rangeBand())
	    .attr("y", function(d: ResponseCount) {
	        return y(d.count);
	    })
	    .attr("height", function(d: ResponseCount) {
	        return height - y(d.count);
	    });

	function wrap(text: any, width: number) {
	    text.each(function() {
	        let text = d3.select(this),
	            words = text.text().split(/\s+/).reverse(),
	            word,
	            line: string[] = [],
	            lineNumber = 0,
	            lineHeight = 1.1, // ems
	            y = text.attr("y"),
	            dy = parseFloat(text.attr("dy")),
	            tspan: any = text.text(null!).append("tspan").attr("x", 0).attr("y", y).attr("dy", dy + "em");
	        while (word = words.pop()) {
	            line.push(word);
	            tspan.text(line.join(" "));
	            if (tspan.node().getComputedTextLength() > width) {
	                line.pop();
	                tspan.text(line.join(" "));
	                line = [word];
	                tspan = text.append("tspan").attr("x", 0).attr("y", y).attr("dy", ++lineNumber * lineHeight + dy + "em").text(word);
	            }
	        }
	    });
	}
}