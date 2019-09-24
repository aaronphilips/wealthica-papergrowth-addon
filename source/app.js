var addon, addonOptions;

$(function () {
    
    addon = new Addon();

    addon.on("init", function (options) {
        // Dashboard is ready and is signaling to the add-on that it should
        // render using the passed in options (filters, language, etc.)
        addonOptions = options;
        $("button").removeAttr("disabled");
        loadPaperGrowthDashboard();
    }).on("update", function (options) {
        // Filters have been updated and Dashboard is passing in updated options
        addonOptions = _.extend(addonOptions, options);
        loadPaperGrowthDashboard();
    });

    function loadPaperGrowthDashboard() {
        addon.api.getInstitutions(getQueryFromOptions(addonOptions)).then(institutions => {
            addonOptions.data = addonOptions.data || {};

            categoryRatios = getCategoryRatios(institutions);
            categoryRatiosWithCash = getCategoryRatiosWithCash(institutions);

            buildPortfolioTargetTable(categoryRatios)
            buildPortfolioPieChart(categoryRatios);
            buildBalancePortfolioTable(categoryRatiosWithCash, institutions);
        });
    }

    $("#save-target").on("click", function () {
        addonOptions.data[$("#selectedCategory").val()] = $("#newTarget").val() / 100;
        addon.saveData(addonOptions.data);
    });

    function buildPortfolioTargetTable(data) {
        $("#category-table").empty();

        Object.entries(addonOptions.data).forEach(([category, target], index) => {
            var actual = data[category] || 0;
            var tr = $("<tr>");
            var button = $("<button>", {
                "id": "category" + index,
                "type": "button",
                "class": "btn btn-light"
            });
            button.html("<i class=\"fas fa-pencil-alt\"></i>");
            $("#category-table").on("click", "#category" + index, function () {
                $("#editTargetModalLabel").html("Edit Target Percentage for " + category);
                $("#selectedCategory").val(category);
                $("#newTarget").attr("placeholder", (target * 100).toFixed(1))
                $("#newTarget").val("")
                $("#editTargetModal").modal("show");
            })
            var td = $("<td>");
            td.addClass("text-right");
            td.html(button);

            tr.append("<td class=\"align-middle\">" + category + "</td>");
            tr.append("<td class=\"text-center align-middle\">" + (target * 100).toFixed(1) + "%</td>");
            tr.append("<td class=\"text-center align-middle " + getTextColor(actual, target) + "\">" + (actual * 100).toFixed(1) + "%</td>");
            tr.append(td);

            $("#category-table").append(tr);
        });
    }

    function buildPortfolioPieChart(data) {
        $("#chart-container").empty();

        var actualSeriesData = Object.entries(data).map(x => ({ "name": x[0], "y": x[1] }));
        var targetSeriesData = Object.entries(addonOptions.data).map(x => ({ "name": x[0], "y": x[1] }));
        Highcharts.chart("chart-container", {
            chart: {
                plotBackgroundColor: null,
                plotBorderWidth: 0,
                plotShadow: false,
            },
            title: {
                text: ""
            },
            tooltip: {
                pointFormat: "{series.name}: <b>{point.percentage:.1f}%</b>"
            },
            plotOptions: {
                pie: {
                    showInLegend: true,
                    colors: [
                        shadeColor("#7f3eab", 0),
                        shadeColor("#7f3eab", 0.2),
                        shadeColor("#7f3eab", 0.4),
                        shadeColor("#7f3eab", 0.6),
                        shadeColor("#7f3eab", 0.8)
                    ],
                    dataLabels: {
                        enabled: false,
                    },
                }
            },
            series: [{
                type: "pie",
                name: "Actual",
                size: "70%",
                data: actualSeriesData
            }, {
                dataLabels: {
                    enabled: false
                },
                showInLegend: false,
                type: "pie",
                name: "Target",
                innerSize: "80%",
                data: targetSeriesData
            }]
        });
    }

    function buildBalancePortfolioTable(actuals, institutions) {
        $("#balance-tables-container").empty();

        var empty = true;
        var investments = Enumerable.from(institutions).selectMany(institution => Enumerable.from(institution.investments).select(i => Object.assign(({ "institutionId": institution._id, "institutionName": institution.name }), i)))
        var accounts = investments.groupBy(i => i.name,
            i => i,
            function (key, group) {
                var account = {
                    "name": group.first().institutionName + " " + key,
                    "institionId": group.first().institutionId,
                    "investmentId": group.first()._id,
                    "cash": group.aggregate(0, (a, b) => a + b.adjustment),
                    "positions": group.selectMany(g => g.positions).toArray(),
                };
                return account;
            }
        ).toArray();

        for (let index = 0; index < accounts.length; index++) {
            const account = accounts[index];

            if (addonOptions.institutionsFilter != null && addonOptions.institutionsFilter.split(",").includes(account.institutionId) == false) {
                continue;
            }

            if (addonOptions.investmentsFilter != null && addonOptions.investmentsFilter.split(",").includes(account.investmentId) == false) {
                continue;
            }

            if (account.cash <= 0.01) {
                continue;
            }

            var table = $("<table>", {
                "class": "table table-sm mb-2"
            });

            table.html(
                `<thead>
          <tr>
            <th>Name</th>
            <th>Quantity</th>
            <th>Amount</th>
          </tr>
        </thead>`
            );

            var adjustments = Enumerable.from(Object.keys(actuals)).select(category => ({ "category": category, "adjustment": addonOptions.data[category] - actuals[category] }))
            adjustments = adjustments.where(a => a.adjustment > 0);

            var totalAdjustment = adjustments.aggregate(0, (a, b) => a + b.cash);

            adjustments = adjustments.toObject(a => a.category, a => a.adjustment / totalAdjustment);

            var tbody = $("<tbody>");

            for (let j = 0; j < account.positions.length; j++) {
                const position = account.positions[j];
                var adjustment = adjustments[position.category];

                if (adjustment == null) {
                    continue;
                }

                var quantity = Math.floor(account.cash * adjustment / position.security.last_price);

                if (quantity > 0 == false) {
                    continue
                }

                empty = false;

                var amount = quantity * position.security.last_price;
                tbody.append(
                    `<tr>
            <td><span class="badge badge-light pt-2 mr-2" style="width: 50px">${position.security.symbol}</span>${position.security.name}</td>
            <td>${quantity}</td>
            <td>${amount.toFixed(2)}</td>
          </tr>`
                );
            }

            if (empty) {
                continue;
            }

            table.append(tbody);

            var div = $("<div>");

            div.html(`<h6>${account.name}</h6>`)
            div.append(table)

            $("#balance-tables-container").append(div);
        }

        if (empty) {
            $("#balance-tables-container").append("<div class=\"alert alert-light\">Congratulations! You're account is properly balanced.</div>");
        }
    }

    function getCategoryRatiosWithCash(institutions) {
        var totalValue = Enumerable.from(institutions).aggregate(0, (a, i) => a + i.value);
        var positions = Enumerable.from(institutions).selectMany(i => i.investments).selectMany(i => i.positions).toArray();

        var categoryRatios = {};
        for (let index = 0; index < positions.length; index++) {
            const position = positions[index];
            var orignalValue = categoryRatios[position.category] || 0;
            categoryRatios[position.category] = orignalValue + (position.market_value / totalValue);
        }

        return categoryRatios;
    }

    function getCategoryRatios(institutions) {
        var totalValue = Enumerable.from(institutions).aggregate(0, (a, i) => a + i.value);
        var totalCash = Enumerable.from(institutions).aggregate(0, (a, i) => a + i.cash);
        var totalWithoutCash = totalValue - totalCash

        var positions = Enumerable.from(institutions).selectMany(i => i.investments).selectMany(i => i.positions).toArray();

        var categoryRatios = {};
        for (let index = 0; index < positions.length; index++) {
            const position = positions[index];
            var orignalValue = categoryRatios[position.category] || 0;
            categoryRatios[position.category] = orignalValue + (position.market_value / totalWithoutCash);
        }

        return categoryRatios;
    }

    // Compose a query object from the addon options to pass to the API calls.
    function getQueryFromOptions(options) {
        return {
            from: options.dateRangeFilter && options.dateRangeFilter[0],
            to: options.dateRangeFilter && options.dateRangeFilter[1],
            groups: options.groupsFilter,
            institutions: options.institutionsFilter,
            investments: options.investmentsFilter === "all" ? null : options.investmentsFilter,
        }
    }

    function shadeColor(color, percent) {
        var f = parseInt(color.slice(1), 16),
            t = percent < 0 ? 0 : 255,
            p = percent < 0 ? percent * -1 : percent,
            R = f >> 16,
            G = f >> 8 & 0x00FF,
            B = f & 0x0000FF;
        return "#" +
            (0x1000000 +
                (Math.round((t - R) * p) + R) * 0x10000 +
                (Math.round((t - G) * p) + G) * 0x100 +
                (Math.round((t - B) * p) + B)).toString(16).slice(1);
    }

    function getTextColor(actual, target) {
        var difference = Math.abs((actual - target) / target);
        return difference > 0.1 ? "text-danger" : difference < 0.01 ? "text-success" : "text-warning";
    }
});