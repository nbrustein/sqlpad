var _ = require('lodash');
var uaParser = require('ua-parser');
var uuid = require('uuid');
var noop = function() {};
var moment = require('moment');
var request = require('request');

module.exports = function(app) {

    var db = app.get('db');

    function getDashboardFilterData(req, res, next) {
        db.connections.find({}, function(err, connections) {
            var connectionsById = _.indexBy(connections, '_id');
            db.dashboards.find({}, function(err, dashboards) {
                var tags = _.uniq(_.flatten(dashboards, 'tags')).sort();
                var createdBys = _.uniq(_.pluck(dashboards, 'createdBy')).sort();
                connections = _.sortBy(connections, 'name');
                res.locals.connectionsById = connectionsById;
                res.locals.connections = connections;
                res.locals.createdBys = createdBys;
                res.locals.tags = tags;
                next();
            });
        });
    }

    // Post to a slack webhook
    function pushDashboardToSlack(dashboard, userEmail, webhookUrl, cb) {
        var options = {
            method: 'post',
            body: {
                "text": "New Dashboard <" + process.env.PUBLIC_URL +
                    "/dashboards/" + dashboard._id + "|" + dashboard.name +
                    "> saved by " + userEmail + " on SqlPad ```" +
                    dashboard.dashboardText + "```"
            },
            json: true,
            url: webhookUrl
        }
        request(options, function(err, httpResponse, body) {
            cb(err);
        });
    }

    app.get('/dashboards', getDashboardFilterData, function(req, res) {
        var filter = {};
        if (req.dashboard && req.dashboard.tag) {
            filter.tags = req.dashboard.tag;
        }
        if (req.dashboard && req.dashboard.connection) {
            filter.connectionId = req.dashboard.connection;
        }
        if (req.dashboard && req.dashboard.createdBy) {
            filter.createdBy = req.dashboard.createdBy;
        }
        if (req.dashboard && req.dashboard.search) {
            var nameRegExp = new RegExp(req.dashboard.search, "i");
            var dashboardTextRegExp = new RegExp(req.dashboard.search, "i");
            filter.$or = [{
                dashboardText: {
                    $regex: dashboardTextRegExp
                }
            }, {
                name: {
                    $regex: nameRegExp
                }
            }];
        }
        var cursor = db.dashboards.find(filter);
        if (req.dashboard && req.dashboard.sortBy) {
            if (req.dashboard.sortBy === "accessed") {
                cursor.sort({
                    lastAccessedDate: -1
                });
            } else if (req.dashboard.sortBy === "modified") {
                cursor.sort({
                    modifiedDate: -1
                });
            } else if (req.dashboard.sortBy === "name") {
                cursor.sort({
                    name: 1
                });
            }
        } else {
            cursor.sort({
                modifiedDate: -1
            });
        }
        cursor.exec(function(err, dashboards) {
            dashboards.forEach(function(dashboard) {
                dashboard.lastAccessedFromNow = moment(dashboard.lastAccessedDate).calendar();
                dashboard.modifiedCalendar = moment(dashboard.modifiedDate).calendar();
                var timeForDiff = dashboard.lastAccessedDate || dashboard.modifiedDate;
                dashboard.timeDiff = new Date() - timeForDiff;
            });
            //dashboards = _.sortBy(dashboards, 'timeDiff');
            if (req.dashboard && req.dashboard.format && req.dashboard.format === "table-only") {
                res.render('dashboards-table', {
                    pageTitle: "Queries",
                    dashboards: dashboards,
                    filter: filter
                });
            } else {
                res.render('dashboards', {
                    pageTitle: "Queries",
                    dashboards: dashboards,
                    filter: filter
                });
            }

        });
    });

    app.get('/dashboards/:_id', function(req, res) {

        var ua = req.headers['user-agent'];
        var os = uaParser.parseOS(ua).toString();
        res.locals.isMac = (os.search(/mac/i) >= 0);
        if (res.locals.isMac) {
            res.locals.controlKeyText = 'Command';
        } else {
            res.locals.controlKeyText = 'Ctrl';
        }

        db.config.findOne({
            key: "allowCsvDownload"
        }, function(err, config) {

            if (err) {
                console.log(err);
            }

            var preventDownload = config && config.value === "false";

            db.connections.find({}, function(err, connections) {
                res.locals.dashboardMenu = true;
                res.locals.cacheKey = uuid.v1();
                res.locals.navbarConnections = _.sortBy(connections, 'name');
                res.locals.allowDownload = !preventDownload;

                if (req.params._id === 'new') {
                    res.render('dashboard', {
                        dashboard: {
                            name: ""
                        }
                    });
                } else {
                    db.dashboards.findOne({
                        _id: req.params._id
                    }, function(err, dashboard) {
                        // TODO: render error if this fails?
                        db.dashboards.update({
                            _id: req.params._id
                        }, {
                            $set: {
                                lastAccessedDate: new Date()
                            }
                        }, {}, noop);
                        if (dashboard && dashboard.tags) dashboard.tags = dashboard.tags.join(', ');
                        if (req.dashboard && req.dashboard.format && req.dashboard.format === 'json') {
                            // send JSON of dashboard object
                            res.json(dashboard);
                        } else {
                            // render page
                            res.render('dashboard', {
                                dashboard: dashboard
                            });
                        }
                    });
                }
            });
        });
    });

    app.post('/dashboards/:_id', function(req, res) {
        // save the dashboard, to the dashboard db
        var bodyDashboard = {
            name: req.body.name || "No Name Dashboard",
            tags: req.body.tags,
            connectionId: req.body.connectionId,
            dashboardText: req.body.dashboardText,
            chartConfiguration: req.body.chartConfiguration,
            modifiedDate: new Date(),
            modifiedBy: req.user.email,
            lastAccessedDate: new Date()
        };
        if (req.params._id == "new") {
            bodyDashboard.createdDate = new Date();
            bodyDashboard.createdBy = req.user.email;

            db.dashboards.insert(bodyDashboard, function(err, dashboard) {
                if (err) {
                    console.log(err);
                    res.send({
                        err: err,
                        success: false
                    });
                } else {
                    db.config.findOne({
                        key: "slackWebhook"
                    }, function(err, webhook) {
                        if (err) console.log(err);
                        if (!webhook) {
                            // if not configured, just return success response
                            res.send({
                                success: true,
                                dashboard: dashboard
                            });
                        } else {
                            pushDashboardToSlack(dashboard, req.user.email, webhook.value, function(err) {
                                if (err) console.log("Something went wrong while sending to Slack.")
                                else {
                                    res.send({
                                        success: true,
                                        dashboard: dashboard
                                    });
                                }
                            });
                        }
                    });
                }
            });
        } else {
            // This style update merges the bodyDashboard values to whatever objects 
            // are matched by the initial filter (in this case, _id, which will only match 1 dashboard)
            db.dashboards.update({
                _id: req.params._id
            }, {
                $set: bodyDashboard
            }, {}, function(err) {
                if (err) {
                    console.log(err);
                    res.send({
                        err: err,
                        success: false
                    });
                } else {
                    bodyDashboard._id = req.params._id;
                    res.send({
                        success: true,
                        dashboard: bodyDashboard
                    });
                }
            });
        }
    });

    app.delete('/dashboards/:_id', function(req, res) {
        db.dashboards.remove({
            _id: req.params._id
        }, function(err) {
            console.log(err);
            res.redirect('/dashboards');
        });
    });

};