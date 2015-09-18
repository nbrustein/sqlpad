var $ = require('jquery');
var keymaster = require('keymaster');
var ChartEditor = require('./component-chart-editor.js');
var DbInfo = require('./component-db-info.js');
var AceSqlEditor = require('./component-ace-sql-editor.js');
var DataGrid = require('./component-data-grid.js');

var DashboardEditor = function () {
    var chartEditor = new ChartEditor();
    var dbInfo = new DbInfo();
    var dataGrid = new DataGrid();
    
    function getDashboardName () {
        return $('#header-dashboard-name').val();
    }
    
    function getDashboardTags () {
        return $.map($('#tags').val().split(','), $.trim);
    }

    function getQueries() {
        $('#query-select').html('');
        $.ajax({
            type: "GET",
            url: "/queries?format=json" 
        }).done(function (data) {
            $('#query-select').html('');
            data.forEach(function(query) {
                var option = $('<option value="'+query._id+'">'+query.name+'</option>');
                $('#query-select').append(option);
            });
        }).fail(function(){
            alert('Failed to load queries');
        });
    }
    
    function saveDashboard () {
        var $dashboardId = $('#dashboard-id');
        var dashboard = {
            name: getDashboardName(),
            tags: getDashboardTags(),
            chartConfiguration: chartEditor.getChartConfiguration()
        };
        $('#btn-save-result').text('saving...').show();
        $.ajax({
            type: "POST",
            url: "/dashboards/" + $dashboardId.val(),
            data: dashboard
        }).done(function (data) {
            if (data.success) {
                window.history.replaceState({}, "dashboard " + data.dashboard._id, "/dashboards/" + data.dashboard._id);
                $dashboardId.val(data.dashboard._id);
                $('#btn-save-result').removeClass('label-info').addClass('label-success').text('Success');
                setTimeout(function () {
                    $('#btn-save-result').fadeOut(400, function () {
                        $('#btn-save-result').removeClass('label-success').addClass('label-info').text('');
                    });
                }, 1000);
            } else {
                $('#btn-save-result').removeClass('label-info').addClass('label-danger').text('Failed');
            }
        }).fail(function () {
            alert('ajax fail');
        });
    }
    
    $('#btn-save-dashboard').click(function (event) {
        event.preventDefault();
        event.stopPropagation();
        saveDashboard();
    });

    $('#add-query-form').submit(function(event){
        event.preventDefault();
        event.stopPropagation();
        var select = $(event.target['query']);
        var queryId = select.val();
        $(select).find('option[value="'+queryId+'"]').remove();
        alert('Figure out how to add '+queryId);
    });
    
    // /*  (re-)render the chart when the viz tab is pressed, 
    //     TODO: only do this if necessary
    // ==============================================================================*/
    // $('a[data-toggle="tab"]').on('shown.bs.tab', function (e) {
    //     // if shown tab was the chart tab, rerender the chart
    //     // e.target is the activated tab
    //     if (e.target.getAttribute("href") == "#tab-content-visualize") {
    //         chartEditor.rerenderChart();
    //     } else if (e.target.getAttribute("href") == "#tab-content-sql") {
    //         dataGrid.resize();
    //     }
    // });
    
    /*  get dashboard again, because not all the data is in the HTML
        TODO: do most the workflow this way? 
    ==============================================================================*/
    var $dashboardId = $('#dashboard-id');
    $.ajax({
        type: "GET",
        url: "/dashboards/" + $dashboardId.val() + "?format=json"
    }).done(function (data) {
        //chartEditor.loadChartConfiguration(data.chartConfiguration);
    }).fail(function () {
        alert('Failed to get additional Dashboard info');
    });
    
    /*  Tags Typeahead
    ==============================================================================*/
    var Bloodhound = require('Bloodhound');
    var bloodhoundTags = new Bloodhound({
      datumTokenizer: Bloodhound.tokenizers.obj.whitespace('name'),
      queryTokenizer: Bloodhound.tokenizers.whitespace,
      prefetch: {
        url: '/tags', // array of tagnames
        ttl: 0,
        filter: function(list) {
          return $.map(list, function(tag) {
            return { name: tag }; });
        }
      }
    });
    bloodhoundTags.initialize();
    $('#tags').tagsinput({
      typeaheadjs: {
        //name: 'tags',
        displayKey: 'name',
        valueKey: 'name',
        source: bloodhoundTags.ttAdapter()
      }
    });
    
    /*  Shortcuts
    ==============================================================================*/
    // keymaster doesn't fire on input/textarea events by default
    // since we are only using command/ctrl shortcuts, 
    // we want the event to fire all the time for any element
    keymaster.filter = function (event) {
        return true; 
    };
    keymaster('ctrl+s, command+s', function() { 
        saveDashboard();
        return false;
    });

    getQueries();
};


module.exports = function () {
    if ($('#dashboard-editor').length) {
        new DashboardEditor();
    }
};