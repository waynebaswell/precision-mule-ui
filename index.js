"use strict";
let map;
let drawingManager;
let selectedShape;
let selectedColor;
let missionPolygon;
let missionPathPolyline;
const colors = ['#1E90FF', '#FF1493', '#32CD32', '#FF8C00', '#4B0082'];
let polyOptions = {
    strokeWeight: 0,
    fillOpacity: 0.45,
    editable: true,
    draggable: true,
    fillColor: colors[0]
};
let startMarker;
let bearingLine;
let missionPathPolylineMarkers = [];
let circleObstacles = new Set(); //Google maps circle obstacle objects
let polyObstacles = new Set(); //Google maps circle polygon objects
const R = 6371000; //Earth radius in meters
const d = 1000; //Heading line distance in meters
//var baseURL = "http://precisionmule.com";
const baseURL = "http://localhost:8080";
//Credit: https://blog.thecell.eu/blog/2017/11/12/customlines-for-google-maps-polylines/
//https://developers.google.com/maps/documentation/javascript/reference?#IconSequence
var iconsequ = [];
//Wrapper type for passing around LatLong values and sending them (via JSON)
//back and forth between the client and server
class LL {
    constructor(lat, lng) {
        this.lat = 0;
        this.lng = 0;
        this.lat = lat;
        this.lng = lng;
    }
}
// SymbolPath https://developers.google.com/maps/documentation/javascript/reference?#SymbolPath
const redCircle = {
    "path": "M -2,0 C -1.947018,-2.2209709 1.9520943,-2.1262691 2,0.00422057 2.0378955,1.3546185 1.5682108,2.0631345 1.4372396e-8,2.0560929 -1.7155482,2.0446854 -1.9145886,1.0142836 -2,0.06735507 Z",
    "fillColor": "#ff0000",
    "fillOpacity": 0.8,
    "strokeColor": "#ff0000",
    "strokeWeight": 30,
    "scale": 0.5
};
const greenCircle = {
    "path": "M -2,0 C -1.947018,-2.2209709 1.9520943,-2.1262691 2,0.00422057 2.0378955,1.3546185 1.5682108,2.0631345 1.4372396e-8,2.0560929 -1.7155482,2.0446854 -1.9145886,1.0142836 -2,0.06735507 Z",
    "fillColor": "#ff0000",
    "fillOpacity": 0.8,
    "strokeColor": "#008000",
    "strokeWeight": 30,
    "scale": 0.50
};
// add Point at the start of the Line
iconsequ.push({
    icon: greenCircle,
    offset: "0%",
    repeat: "0"
});
// add Point at the end of the Line
iconsequ.push({
    icon: redCircle,
    offset: "100%",
    repeat: "0"
});
//JSON local storage helper functions
//credit: https://stackoverflow.com/questions/2010892/storing-objects-in-html5-localstorage?rq=1
Storage.prototype.setObject = function (key, value) {
    this.setItem(key, JSON.stringify(value));
};
Storage.prototype.getObject = function (key) {
    var value = this.getItem(key);
    return value && JSON.parse(value);
};
//Functions for map geo math
//credit: http://www.movable-type.co.uk/scripts/latlong.html#destPoint
//Converts numeric degrees to radians
if (typeof (Number.prototype.toRad) === "undefined") {
    Number.prototype.toRad = function () {
        return this * Math.PI / 180;
    };
}
//Converts radians to numeric (signed) degrees
if (typeof (Number.prototype.toDeg) === "undefined") {
    Number.prototype.toDeg = function () {
        return this * 180 / Math.PI;
    };
}
// document.getElementById shorthand
// credit: https://stackoverflow.com/questions/6398787/javascript-shorthand-for-getelementbyid
let $ = function (id) { return document.getElementById(id); };
/**
 * credit: https://stackoverflow.com/questions/10223898/draw-line-in-direction-given-distance-google-maps
 *
 * @param lat1 Latitude of starting point marker
 * @param lon1 Longitude of starting point marker
 * @param brng Mission bearing
 */
function bearingLineEndpointCoords(lat1, lon1, brng) {
    lat1 = lat1.toRad();
    lon1 = lon1.toRad();
    brng = brng.toRad();
    let lat2 = Math.asin(Math.sin(lat1) * Math.cos(d / R) +
        Math.cos(lat1) * Math.sin(d / R) * Math.cos(brng));
    let lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d / R) * Math.cos(lat1), Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2));
    return new LL(lat2.toDeg(), lon2.toDeg());
}
/**
 * Call this guy when heading text input changes -- checks
 * if input is a valid number and if so,
 * re-draws the bearing line
 *
 * @param val Heading value user enters in the heading input box
 */
function headingOnInput(val) {
    if (!isNaN(val)) {
        setCookie("heading", `${val}`);
        if (startMarker != null && startMarker.getPosition() != null) {
            let nonNullPosition = startMarker.getPosition();
            drawBearingLine(nonNullPosition.lat(), nonNullPosition.lng(), parseFloat(val));
        }
        else {
            console.log("startMarker is null");
        }
    }
    else {
        console.log(`the heading specified (${val}) is not a number -- cannot draw a new heading line`);
    }
}
/**
 * Call this guy when path width text input changes -- saves path width
 *
 * @param val Heading value user enters in the heading input box
 */
function pathWidthOnInput(val) {
    if (!isNaN(val)) {
        setCookie("pathWidth", `${val}`);
        console.log("saved path width to cookie");
    }
    else {
        console.log(`the path width specified (${val}) is not a number`);
    }
}
/**
 * Save the waypoints locally as an ArduPilot waypoint file
 *
 * @param filename Filename to save file locally as
 * @param text Contents of file
 */
function download(filename, text) {
    var element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}
/**
 * Sets up logic to allow user to upload a mission polygon file
 * into the app
 */
function setupFileListener() {
    $('file').onchange = function () {
        var file = this.files[0];
        var reader = new FileReader();
        reader.onload = function (progressEvent) {
            // Entire file
            console.log(this.result);
            var userEnteredMapData = JSON.parse(this.result);
            loadPolygonFromUserMapDataRecord(userEnteredMapData);
        };
        reader.readAsText(file);
    };
    //This ensures the file will be imported in the event that
    //the user is re-uploading a file of the same name of the
    //file they just uploaded
    //credit: https://stackoverflow.com/questions/12030686/html-input-file-selection-event-not-firing-upon-selecting-the-same-file
    $('file').onclick = function () {
        this.value = null;
    };
}
/**
 * Initial map loading and setup
 */
function initMap() {
    map = new google.maps.Map($('map'), {
        center: { lat: 30.56, lng: -87.67 },
        zoom: 2,
        mapTypeId: 'hybrid',
        tilt: 0,
        labels: true
    });
    setCustomZoom();
    addDrawingToolsToMap();
    loadMapLocationFromCookie();
    let headingNumber = parseFloat($('heading').value);
    addStartingLocationMarker(headingNumber);
    setupFileListener();
    let pathWidthCookieValue = getCookie("pathWidth");
    if (pathWidthCookieValue) {
        $('pathWidth').value = pathWidthCookieValue;
    }
    let headingCookieValue = getCookie("heading");
    if (headingCookieValue) {
        $('heading').value = headingCookieValue;
    }
}
/**
 * Increase the map zoom for fine-tuning mission location
 * Credit: https://stackoverflow.com/questions/30136525/allow-further-zoom-on-google-maps-v3-satellite-view?rq=1
 */
function setCustomZoom() {
    let zoomRangeModifier = map.__proto__.__proto__.__proto__;
    let originalSetFunc = zoomRangeModifier.set;
    let hijackedSetFunc = function (a, b) {
        if (a === 'maxZoom') {
            b = 25;
        }
        originalSetFunc.call(this, a, b);
    };
    zoomRangeModifier.set = hijackedSetFunc;
}
/**
 * Map karate credit to Ilya Radchenko: http://bl.ocks.org/knownasilya/89a32e572989f0aff1f8
 */
function clearSelection() {
    if (selectedShape) {
        if (selectedShape.type !== 'marker') {
            selectedShape.setEditable(false);
        }
        selectedShape = null;
    }
}
/**
 * Sets the selectedShape var that's used in other places and makes the shape
 * editable if it's not a marker
 *
 * @param shape Shape object to set as selected
 */
function setSelection(shape) {
    if (shape.type !== 'marker') {
        clearSelection();
        shape.setEditable(true);
        //selectColor(shape.get('fillColor') || shape.get('strokeColor'));
    }
    selectedShape = shape;
}
/**
 * If the selected shape is the main mission polygon, present the user
 * a confirmation box just to ensure this is
 * what they'd wanted to do
 */
function confirmDeleteSelectedShape() {
    if (selectedShape != null) {
        if (selectedShape == missionPolygon) {
            polyOptions.fillColor = '#CCCC00';
            missionPolygon.setOptions(polyOptions);
            setTimeout(confirmDeleteSelectedShapeAsync, 100);
        }
        else {
            deleteSelectedShape();
        }
    }
}
/**
 * Helper function for confirming because I was having trouble
 * getting the selected polygon to highlight without a
 * little wait before the js confirm dialog
 */
function confirmDeleteSelectedShapeAsync() {
    var proceed = confirm("Main polygon is selected..are you sure?");
    polyOptions.fillColor = colors[0];
    missionPolygon.setOptions(polyOptions);
    if (proceed) {
        deleteSelectedShape();
    }
}
/**
 * Delete shape that is currently selected on map
 */
function deleteSelectedShape() {
    if (selectedShape != null) {
        if (selectedShape == missionPolygon) {
            missionPolygon.setMap(null);
            drawingManager.setOptions({
                drawingMode: google.maps.drawing.OverlayType.POLYGON,
                drawingControl: true
            });
            if (missionPathPolyline != null) {
                missionPathPolyline.setMap(null);
            }
        }
        else {
            if (circleObstacles.has(selectedShape)) {
                circleObstacles.delete(selectedShape);
            }
            if (polyObstacles.has(selectedShape)) {
                polyObstacles.delete(selectedShape);
            }
            selectedShape.setMap(null);
        }
    }
}
/**
 * Save the main mission polygon to local storage
 */
function savePolygon() {
    var userEnteredMapData = mapUserEnteredMapDataAsBigHonkinHash(false);
    localStorage.setObject('userEnteredMapData', userEnteredMapData);
}
/**
 * Download the mission polygon to a local json file
 */
function downloadPolygon() {
    if (missionPolygon) {
        var userEnteredMapData = mapUserEnteredMapDataAsBigHonkinHash(false);
        var userEnteredMapDataAsString = JSON.stringify(userEnteredMapData);
        download("polygon.json", userEnteredMapDataAsString);
    }
}
/**
 * Load mission polygon from polygon saved in localStorage
 */
function loadSavedPolygon() {
    let userEnteredMapData = localStorage.getObject('userEnteredMapData');
    loadPolygonFromUserMapDataRecord(userEnteredMapData);
}
/**
 * Clears out the map data
 */
function clearUserMapData() {
    circleObstacles.forEach(function (circle, i) {
        circle.setMap(null);
    });
    polyObstacles.forEach(function (poly, i) {
        poly.setMap(null);
    });
    if (missionPolygon) {
        missionPolygon.setMap(null);
    }
    if (missionPathPolyline) {
        missionPathPolyline.setMap(null);
    }
}
/**
 * Load mission data into visible google map
 *
 * @param userEnteredMapData Record<string, any> of coordinates representing the
 * main mission polygon, coordinates of the obstacles and marker,
 * and the path width and heading information
 */
function loadPolygonFromUserMapDataRecord(userEnteredMapData) {
    clearUserMapData();
    let missionPolygonlls = userEnteredMapData['missionPolygon'];
    var pathMVCArray = new google.maps.MVCArray();
    if (missionPolygonlls) {
        for (var i = 0; i < missionPolygonlls.length; i++) {
            var obj = missionPolygonlls[i];
            pathMVCArray.push(new google.maps.LatLng(obj.lat, obj.lng));
        }
        missionPolygon = new google.maps.Polygon();
        missionPolygon.setOptions(polyOptions);
        missionPolygon.setPath(pathMVCArray);
        missionPolygon.setMap(map);
        drawingManager.setDrawingMode(null);
        drawingManager.setOptions({
            drawingControl: false
        });
        map.setOptions({ draggableCursor: '' });
        //addPolygonClickHandlers();
        // Add an event listener that selects the newly-drawn shape when the user
        // mouses down on it.
        google.maps.event.addListener(missionPolygon, 'click', function (e) {
            if (e.vertex !== undefined) {
                var path = missionPolygon.getPaths().getAt(e.path);
                path.removeAt(e.vertex);
                if (path.getLength() < 3) {
                    missionPolygon.setMap(null);
                }
            }
            setSelection(missionPolygon);
        });
    }
    let smLL = userEnteredMapData['startMarker'];
    startMarker.setPosition(new google.maps.LatLng(smLL.lat, smLL.lng));
    let headingVal = userEnteredMapData['heading'];
    let mowingPathWidthInMetersVal = userEnteredMapData['mowingPathWidthInMeters'];
    $('heading').value = headingVal;
    $('pathWidth').value = mowingPathWidthInMetersVal;
    headingOnInput(headingVal);
    let circleArray = userEnteredMapData['circleObstacles'];
    let polyArray = userEnteredMapData['polyObstacles'];
    circleObstacles = new Set();
    polyObstacles = new Set();
    circleArray.forEach(function (circle, i) {
        let radius = circle['radius'];
        let lat = circle['lat'];
        let lng = circle['lng'];
        addCircleObstacleOptions(radius, lat, lng);
    });
    polyArray.forEach(function (poly, i) {
        addPolyObstacleOptions(poly);
    });
}
/**
 * I'm not entirely sure if we actually still need this function
 *
 * @param color String hex color (i.e. '#1E90FF')
 */
function selectColor(color) {
    selectedColor = color;
    // Retrieves the current options from the drawing manager and replaces the
    // stroke or fill color as appropriate.
    var polylineOptions = drawingManager.get('polylineOptions');
    polylineOptions.strokeColor = color;
    drawingManager.set('polylineOptions', polylineOptions);
    var rectangleOptions = drawingManager.get('rectangleOptions');
    rectangleOptions.fillColor = color;
    drawingManager.set('rectangleOptions', rectangleOptions);
    var circleOptions = drawingManager.get('circleOptions');
    circleOptions.fillColor = color;
    drawingManager.set('circleOptions', circleOptions);
    var polygonOptions = drawingManager.get('polygonOptions');
    polygonOptions.fillColor = color;
    drawingManager.set('polygonOptions', polygonOptions);
}
/**
 * Post all the mission data up to the server so that the server can build
 * the corresponding mission path
 *
 * @param truckLoadOfDataForServer Big stringified json object of data -- this
 * should probably be broken down into several parameters rather than this
 * big opaque key/value json obect we're currently rolling
 * @param mowingPathWidthInMeters Distance between waypoints
 */
function postData(truckLoadOfDataForServer, mowingPathWidthInMeters) {
    fetch(baseURL + '/missionbuilder/api/buildMissionFromLatLngPoints?mowingPathWidthInMeters=' + mowingPathWidthInMeters, {
        method: 'POST',
        body: truckLoadOfDataForServer
    }).then((res) => res.json())
        .then((data) => addMissionPolylineToMap(data))
        .catch((err) => console.log("Whupps we have an error: " + err));
}
/**
 * Draw polyline on map representing the mission path
 *
 * @param jsonData Sequentially ordered array of ILL Latitude/Longitude values
 * representing all waypoints that comprise the mission -- in other words,
 * the first element of the array is the first point of the mission,
 * the second element is the next point the rover will navigate
 * to and so on 'till the last element in the array which is
 * the final waypoint of the mission path
 */
function addMissionPolylineToMap(jsonData) {
    if (missionPathPolyline != null) {
        missionPathPolyline.setMap(null);
    }
    //Logging mission polyline for debugging
    console.log("Begin logging missionPathPolyline");
    for (var x = 0; x < jsonData.length; x++) {
        var latLng = jsonData[x];
        console.log(`${x} Latitude: ${latLng.lat} Longitude: ${latLng.lng}`);
    }
    console.log("End logging missionPathPolyline");
    missionPathPolyline = new google.maps.Polyline({
        path: jsonData,
        geodesic: true,
        strokeColor: '#008000',
        strokeOpacity: 1.0,
        strokeWeight: 2,
        editable: true,
        icons: iconsequ
    });
    google.maps.event.addListener(missionPathPolyline, "dragend", updateMissionPathPolylineMarkers);
    google.maps.event.addListener(missionPathPolyline.getPath(), "insert_at", updateMissionPathPolylineMarkers);
    google.maps.event.addListener(missionPathPolyline.getPath(), "remove_at", updateMissionPathPolylineMarkers);
    google.maps.event.addListener(missionPathPolyline.getPath(), "set_at", updateMissionPathPolylineMarkers);
    missionPathPolyline.setMap(map);
    updateMissionPathPolylineMarkers();
}
function updateMissionPathPolylineMarkers() {
    var path = missionPathPolyline.getPath();
    var len = path.getLength();
    for (var x = 0; x < missionPathPolylineMarkers.length; x++) {
        missionPathPolylineMarkers[x].setMap(null);
    }
    var checkbox = $('showWaypointNumbersCheckbox');
    if (checkbox.checked == true) {
        for (var i = 0; i < len; i++) {
            var marker = new google.maps.Marker({
                position: path.getAt(i),
                label: (i + 1).toString(),
                draggable: true,
                map: map
            });
            missionPathPolylineMarkers.push(marker);
            bindMarkerToMissionPathPolyline(marker, i);
        }
    }
}
/**
 * When user moves mission vertex marker, update the corresponding lat/lng
 * vertex on the mission polyline accordingly
 *
 * @param marker The marker to bind to
 * @param index Polyline index to replace lat/lng value of
 */
function bindMarkerToMissionPathPolyline(marker, index) {
    google.maps.event.addListener(marker, 'dragend', function () {
        var newMarkerLatLng = marker.getPosition();
        var path = missionPathPolyline.getPath();
        path.setAt(index, new google.maps.LatLng(newMarkerLatLng.lat(), newMarkerLatLng.lng()));
    });
}
/**
 * Build a big ArduPilot mission waypoint string that the user will be able to
 * download as a file (and then load the file into their Flight Controller)
 *
 * @see https://mavlink.io/en/file_formats/ For more information
 * on the waypoint file format
 *
 * @param waypointMVCArray Array of LatLong points arranged sequentially: i.e.
 * the first item in the array is the first waypoint
 * and the last item is the last waypoint
 */
function buildMissionWaypointString(waypointMVCArray) {
    var missionString = buildWaypointFileFirstLine() + "\n";
    for (var x = 0; x < waypointMVCArray.getLength(); x++) {
        var lat = waypointMVCArray.getAt(x).lat();
        var lng = waypointMVCArray.getAt(x).lng();
        if (x == 0) {
            //Add first line twice (i.e. to set first point as home)
            missionString += buildWaypointFileLatLngLine(x, lat, lng) + "\n";
        }
        missionString += buildWaypointFileLatLngLine(x + 1, lat, lng) + "\n";
    }
    return missionString;
}
/**
 * Build the standard first line of the waypoint file
 */
function buildWaypointFileFirstLine() {
    var header = "QGC WPL 110";
    return header;
}
/**
 * Build the standard waypoint line
 *
 * @param index Zero-based incrementing index that is the first element in the waypoint line format
 * (i.e. the first waypoint is 0, the next is 1 and so on)
 * @param lat Latitude
 * @param lng Longitude
 */
function buildWaypointFileLatLngLine(index, lat, lng) {
    return index + "\t0\t3\t16\t0\t0\t0\t0\t" + lat + "\t" + lng + "\t100.000000\t1";
}
/**
 *
 */
function addPolygonClickHandlers() {
    google.maps.event.addListener(drawingManager, 'overlaycomplete', function (e) {
        var newShape = e.overlay;
        newShape.type = e.type;
        if (e.type !== google.maps.drawing.OverlayType.MARKER) {
            // Switch back to non-drawing mode after drawing a shape.
            drawingManager.setDrawingMode(null);
            // Add an event listener that selects the newly-drawn shape when the user
            // mouses down on it.
            google.maps.event.addListener(newShape, 'click', function (e) {
                if (e.vertex !== undefined) {
                    if (newShape.type === google.maps.drawing.OverlayType.POLYGON) {
                        var path = newShape.getPaths().getAt(e.path);
                        path.removeAt(e.vertex);
                        if (path.length < 3) {
                            newShape.setMap(null);
                        }
                    }
                    if (newShape.type === google.maps.drawing.OverlayType.POLYLINE) {
                        var path = newShape.getPath();
                        path.removeAt(e.vertex);
                        if (path.length < 2) {
                            newShape.setMap(null);
                        }
                    }
                }
                setSelection(newShape);
            });
            setSelection(newShape);
        }
        else {
            google.maps.event.addListener(newShape, 'click', function (e) {
                setSelection(newShape);
            });
            setSelection(newShape);
        }
    });
}
/**
 * Add a generic polygon-shaped area to the center of the map -- the idea
 * is that users will move and reshape the polygon over
 * areas that they want their mower to avoid
 */
function addPolyObstacle() {
    var polyCoords = [
        { lat: map.getCenter().lat() + .00002, lng: map.getCenter().lng() - .00002 },
        { lat: map.getCenter().lat() + .00002, lng: map.getCenter().lng() + .00002 },
        { lat: map.getCenter().lat() - .00002, lng: map.getCenter().lng() + .00002 },
        { lat: map.getCenter().lat() - .00002, lng: map.getCenter().lng() - .00002 }
    ];
    //add obstacle to visible center of map
    var polyObstacle = addPolyObstacleOptions(polyCoords);
    setSelection(polyObstacle);
}
function addPolyObstacleOptions(vertices) {
    //add obstacle to visible center of map
    var polyObstacle = new google.maps.Polygon({
        map: map,
        paths: vertices,
        strokeColor: '#FF0000',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: '#FF0000',
        fillOpacity: 0.35,
        draggable: true,
        editable: true,
        geodesic: true,
        zIndex: 100
    });
    google.maps.event.addListener(polyObstacle, 'click', function (e) {
        setSelection(polyObstacle);
    });
    polyObstacles.add(polyObstacle);
    return polyObstacle;
}
/**
 * Add a generic circle-shaped area to the center of the map -- the idea
 * is that users will move and reshape the circle over
 * areas that they want their mower to avoid
 */
function addCircleObstacle() {
    let circleObstacle = addCircleObstacleOptions(2, map.getCenter().lat(), map.getCenter().lng());
    setSelection(circleObstacle);
}
function addCircleObstacleOptions(radius, lat, lng) {
    var circleObstacle = new google.maps.Circle({
        strokeColor: '#FF0000',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: '#FF0000',
        fillOpacity: 0.35,
        map: map,
        center: new google.maps.LatLng(lat, lng),
        radius: radius,
        draggable: true,
        editable: true,
        zIndex: 100
    });
    google.maps.event.addListener(circleObstacle, 'click', function (e) {
        setSelection(circleObstacle);
    });
    circleObstacles.add(circleObstacle);
    return circleObstacle;
}
/**
 * Add drawing tools (i.e. that user will use to draw mission) to map
 */
function addDrawingToolsToMap() {
    // Creates a drawing manager attached to the map that allows the user to draw
    // markers, lines, and shapes.
    drawingManager = new google.maps.drawing.DrawingManager({
        drawingMode: google.maps.drawing.OverlayType.POLYGON,
        drawingControlOptions: {
            drawingModes: [
                google.maps.drawing.OverlayType.POLYGON
            ]
        },
        markerOptions: {
            draggable: true
        },
        polylineOptions: {
            editable: true,
            draggable: true
        },
        rectangleOptions: polyOptions,
        circleOptions: polyOptions,
        polygonOptions: polyOptions,
        map: map
    });
    addPolygonClickHandlers();
    // Clear the current selection when the drawing mode is changed, or when the
    // map is clicked.
    google.maps.event.addListener(drawingManager, 'drawingmode_changed', clearSelection);
    google.maps.event.addListener(map, 'click', clearSelection);
    google.maps.event.addDomListener($('deleteBtn'), 'click', confirmDeleteSelectedShape);
    google.maps.event.addDomListener($('savePolygonBtn'), 'click', savePolygon);
    google.maps.event.addDomListener($('loadPolygonBtn'), 'click', loadSavedPolygon);
    google.maps.event.addDomListener($('downloadPolygonBtn'), 'click', downloadPolygon);
    google.maps.event.addDomListener($('addCircleObstacleBtn'), 'click', addCircleObstacle);
    google.maps.event.addDomListener($('addPolyObstacleBtn'), 'click', addPolyObstacle);
    selectColor(colors[0]);
    google.maps.event.addListener(drawingManager, 'polygoncomplete', function (polygon) {
        missionPolygon = polygon;
        drawingManager.setOptions({
            drawingControl: false
        });
    });
    google.maps.event.addDomListener($('downloadWaypointsBtn'), 'click', function () {
        if (missionPathPolyline != null) {
            var missionWaypointString = buildMissionWaypointString(missionPathPolyline.getPath());
            download("mission.waypoints", missionWaypointString);
        }
    });
    google.maps.event.addDomListener($('buildMissionBtn'), 'click', function () {
        var truckLoadOfDataForServer = mapUserEnteredMapDataAsBigHonkinHash(true);
        let pathWidthStr = $('pathWidth').value;
        //Now we want to send this data up to the server
        postData(JSON.stringify(truckLoadOfDataForServer), pathWidthStr);
        saveMapLocationToCookie();
    });
} //End function addDrawingToolsToMap
/**
 * Constructs an object holding all the user-entered map data
 *
 * @param saveCirclesAsPolygons Do you want this method to appoximate the circles
 * as polygons and throw them in with the other polygons? Presently we do
 * this for sending the data to the server but for saving the client
 * data locally we retain the original circle dimensions.
 */
function mapUserEnteredMapDataAsBigHonkinHash(saveCirclesAsPolygons) {
    let missionPolygonLatLng = [];
    var polygonBounds = missionPolygon.getPath();
    // Iterate over the polygonBounds vertices.
    polygonBounds.forEach(function (xy, i) {
        missionPolygonLatLng.push(new LL(xy.lat(), xy.lng()));
    });
    var latLngBoundsString = JSON.stringify(missionPolygonLatLng);
    console.log(latLngBoundsString);
    var polyArray = [];
    polyObstacles.forEach(function (poly, i) {
        var polyObstacleBoundsArray = [];
        poly.getPath().forEach(function (xy, i) {
            polyObstacleBoundsArray.push(new LL(xy.lat(), xy.lng()));
        });
        polyArray.push(polyObstacleBoundsArray);
    });
    let startLat = startMarker.getPosition().lat();
    let startLng = startMarker.getPosition().lng();
    var bigHonkinUserMapDataHash = {
        'missionPolygon': missionPolygonLatLng,
        'startMarker': new LL(startLat, startLng),
        'mowingPathWidthInMeters': $('pathWidth').value,
        'heading': $('heading').value
    };
    if (saveCirclesAsPolygons) {
        circleObstacles.forEach(function (circle, i) {
            var circleAsLagLngArray = approximateCircleAsPolygon(circle.getCenter(), circle.getRadius(), 18);
            polyArray.push(circleAsLagLngArray);
        });
    }
    else {
        var circleArray = [];
        circleObstacles.forEach(function (circle, i) {
            var center = circle.getCenter();
            var radius = circle.getRadius();
            var circleObstacleMap = {
                'radius': radius,
                'lat': center.lat(),
                'lng': center.lng()
            };
            circleArray.push(circleObstacleMap);
        });
        bigHonkinUserMapDataHash['circleObstacles'] = circleArray;
    }
    bigHonkinUserMapDataHash['polyObstacles'] = polyArray;
    return bigHonkinUserMapDataHash;
}
/**
 * Approximate circle as polygon
 *
 * Returns a series of polygon points of type Array<ILL> that represent the
 * approximation of the circle as a polyon
 *
 * Credit: https://stackoverflow.com/questions/24733481/how-to-draw-a-circle-using-polygon-in-googlemaps
 *
 * @param center Latitude/Longitude of circle' center
 * @param radius Radius in meters
 * @param points Number of polygon vertices to use to reflect the circle as a polygon
 */
function approximateCircleAsPolygon(center, radius, points) {
    let llArray = [];
    let p = 360 / points;
    let d = 0;
    for (var i = 0; i < points; ++i, d += p) {
        var offsetLatLng = google.maps.geometry.spherical.computeOffset(center, radius, d);
        llArray.push(new LL(offsetLatLng.lat(), offsetLatLng.lng()));
    }
    return llArray;
}
/**
 * Map save location logic credit: https://www.daftlogic.com/sandbox-google-maps-remember-last-location.htm
 */
function saveMapLocationToCookie() {
    let mapzoom = map.getZoom();
    let mapcenter = map.getCenter();
    let maplat = mapcenter.lat();
    let maplng = mapcenter.lng();
    let maptypeid = map.getMapTypeId();
    let cookiestring = maplat + "_" + maplng + "_" + mapzoom + "_" + maptypeid;
    let exp = new Date(); //set new date object
    exp.setTime(exp.getTime() + (1000 * 60 * 60 * 24 * 30)); //set it 30 days ahead
    setCookie("GoogleMapsLocation", cookiestring, exp);
}
/**
 * If user previously zoomed in on a location let's give them that location when they come
 * back (i.e. instead of some random high-level location like the Statue of Liberty)
 */
function loadMapLocationFromCookie() {
    let loadedstring = getCookie("GoogleMapsLocation");
    if (loadedstring) {
        let splitstr = loadedstring.split("_");
        let latlng = new google.maps.LatLng(parseFloat(splitstr[0]), parseFloat(splitstr[1]));
        let savedMapZoom = parseFloat(splitstr[2]);
        //If we don't scale-back the zoom when the user loads the page
        //they may get a gray screen that's basically non-operable (i.e.
        //unless they know to start zooming out)
        if (savedMapZoom > 21.0) {
            savedMapZoom = 21.0;
        }
        map.setCenter(latlng);
        map.setZoom(savedMapZoom);
        map.setMapTypeId(splitstr[3]);
    }
    else {
        //baswell begin testing
        var latlng = new google.maps.LatLng(30.563413767103118, -87.67843377406932);
        map.setCenter(latlng);
        map.setZoom(21);
        map.setMapTypeId("hybrid");
        //baswell end testing
    }
}
/**
 * Helper function for setting cookies
 *
 * @param name Cookie name
 * @param value Cookie value
 * @param expires Cookie expiration date
 */
function setCookie(name, value, expires) {
    if (expires == null) {
        expires = new Date(); //set new date object
        expires.setTime(expires.getTime() + (1000 * 60 * 60 * 24 * 30)); //set it 30 days ahead
    }
    document.cookie = name + "=" + escape(value) + "; path=/" + ((expires == null) ? "" : "; expires=" + expires.toUTCString());
}
/**
 * Helper function for reading cookies
 *
 * @param name Cookie name
 */
function getCookie(name) {
    if (document.cookie.length > 0) {
        let cStart = document.cookie.indexOf(name + "=");
        if (cStart != -1) {
            cStart = cStart + name.length + 1;
            let cEnd = document.cookie.indexOf(";", cStart);
            if (cEnd == -1)
                cEnd = document.cookie.length;
            return unescape(document.cookie.substring(cStart, cEnd));
        }
    }
    return "";
}
/**
 * Adds a marker to the map that represents that starting
 * location of the mission -- user can drag the marker
 * around to decide where they want the mission
 * to start -- also note we draw a dashed
 * line starting at this marker to
 * show the mission heading
 *
 * @param heading Heading at which to draw heading line
 */
function addStartingLocationMarker(heading) {
    startMarker = new google.maps.Marker({
        position: map.getCenter(),
        label: 'Go',
        title: 'Location where robot begins mission',
        draggable: true,
        map: map
    });
    var bearingEndPointLatLong = bearingLineEndpointCoords(map.getCenter().lat(), map.getCenter().lng(), heading);
    var bearingLineCoordinates = [
        { lat: map.getCenter().lat(), lng: map.getCenter().lng() },
        { lat: bearingEndPointLatLong.lat, lng: bearingEndPointLatLong.lng }
    ];
    // Define a symbol using SVG path notation
    var lineSymbol = {
        path: 'M 0,-1 0,1',
        strokeColor: '#FF0000',
        strokeOpacity: 0.8,
        scale: 2
    };
    bearingLine = new google.maps.Polyline({
        path: bearingLineCoordinates,
        geodesic: true,
        strokeOpacity: 0,
        icons: [{
                icon: lineSymbol,
                offset: '0',
                repeat: '20px'
            }],
        map: map
    });
    startMarkerMovedRedrawHeadingListener();
}
/**
 * Draw the dashed bearing indicator line on the map -- the "bearing" we're
 * talking about here is the heading of the up-and-down
 * (or side-to-side) mission
 *
 * @param latStart Latitude of mission starting point marker
 * @param lngStart Longitude of mission starting point marker
 * @param heading Heading of line we'll draw
 */
function drawBearingLine(latStart, lngStart, heading) {
    var bearingEndPointLatLong = bearingLineEndpointCoords(latStart, lngStart, heading);
    var bearingLineCoordinates = [
        { lat: latStart, lng: lngStart },
        { lat: bearingEndPointLatLong.lat, lng: bearingEndPointLatLong.lng }
    ];
    bearingLine.setPath(bearingLineCoordinates);
}
/**
 * When user drags the startMarker around, update the bearing line
 * to "attach" to the startMarker
 */
function startMarkerMovedRedrawHeadingListener() {
    google.maps.event.addListener(startMarker, 'dragend', function (evt) {
        let inputValue = $('heading').value;
        drawBearingLine(evt.latLng.lat(), evt.latLng.lng(), parseFloat(inputValue));
    });
    google.maps.event.addListener(startMarker, 'drag', function (evt) {
        let inputValue = $('heading').value;
        drawBearingLine(evt.latLng.lat(), evt.latLng.lng(), parseFloat(inputValue));
    });
}
