let map: google.maps.Map;
let drawingManager: google.maps.drawing.DrawingManager;
let selectedShape: google.maps.MVCObject;

let selectedColor: string;
let colorButtons:object = {};

let missionPolygon: google.maps.Polygon;
let missionPathPolyline: google.maps.Polyline;

let polyOptions: any = {
    strokeWeight: 0,
    fillOpacity: 0.45,
    editable: true,
    draggable: true,
    fillColor: '#1E90FF'
};

let startMarker: google.maps.Marker;
let bearingLine: google.maps.Polyline;

let circleObstacles: Set<google.maps.Circle> = new Set(); //Google maps circle obstacle objects
let polyObstacles: Set<google.maps.Polygon> = new Set(); //Google maps circle polygon objects

const colors: string[] = ['#1E90FF', '#FF1493', '#32CD32', '#FF8C00', '#4B0082'];
const R: number = 6371000; //Earth radius in meters
const d: number = 1000; //Heading line distance in meters

//var baseURL = "http://precisionmule.com";
const baseURL: string = "http://localhost:8080";

//Credit: https://blog.thecell.eu/blog/2017/11/12/customlines-for-google-maps-polylines/
//https://developers.google.com/maps/documentation/javascript/reference?#IconSequence
var iconsequ: Array<object> = [];

//Wrapper type for passing around LatLong values and sending them (via JSON)
//back and forth between the client and server
class LL
{
    lat: number = 0;
    lng: number = 0;
    constructor(lat: number, lng: number)
    {
        this.lat = lat;
        this.lng = lng;
    }
}

// SymbolPath https://developers.google.com/maps/documentation/javascript/reference?#SymbolPath
const redCircle: object = {
    "path": "M -2,0 C -1.947018,-2.2209709 1.9520943,-2.1262691 2,0.00422057 2.0378955,1.3546185 1.5682108,2.0631345 1.4372396e-8,2.0560929 -1.7155482,2.0446854 -1.9145886,1.0142836 -2,0.06735507 Z",
    "fillColor": "#ff0000",
    "fillOpacity": 0.8,
    "strokeColor": "#ff0000",
    "strokeWeight": 30,
    "scale": 0.5
};

const greenCircle: object = {
    "path": "M -2,0 C -1.947018,-2.2209709 1.9520943,-2.1262691 2,0.00422057 2.0378955,1.3546185 1.5682108,2.0631345 1.4372396e-8,2.0560929 -1.7155482,2.0446854 -1.9145886,1.0142836 -2,0.06735507 Z",
    "fillColor": "#ff0000",
    "fillOpacity": 0.8,
    "strokeColor": "#008000",
    "strokeWeight": 30,
    "scale": 0.50
};

// add Point at the start of the Line
iconsequ.push(
{
    icon: greenCircle,
    offset: "0%",
    repeat: "0"
});

// add Point at the end of the Line
iconsequ.push(
{
    icon: redCircle,
    offset: "100%",
    repeat: "0"
});

//JSON local storage helper functions
//credit: https://stackoverflow.com/questions/2010892/storing-objects-in-html5-localstorage?rq=1
Storage.prototype.setObject = function (key: string, value: any)
{
    this.setItem(key, JSON.stringify(value));
}

Storage.prototype.getObject = function (key: string)
{
    var value = this.getItem(key);
    return value && JSON.parse(value);
}

//Functions for map geo math
//credit: http://www.movable-type.co.uk/scripts/latlong.html#destPoint

//Converts numeric degrees to radians
if (typeof(Number.prototype.toRad) === "undefined") {
    Number.prototype.toRad = function() {
        return (this as number) * Math.PI / 180;
    }
}

//Converts radians to numeric (signed) degrees
if (typeof(Number.prototype.toDeg) === "undefined") {
    Number.prototype.toDeg = function() {
        return (this as number) * 180 / Math.PI;
    }
}

//document.getElementById shorthand
//credit: https://stackoverflow.com/questions/6398787/javascript-shorthand-for-getelementbyid
let $ = function( id: string ) { return document.getElementById( id ); };

//credit: https://stackoverflow.com/questions/10223898/draw-line-in-direction-given-distance-google-maps
function bearingLineEndpointCoords(lat1: number, lon1: number, brng:number): LL
{
    lat1 = lat1.toRad();
    lon1 = lon1.toRad();
    brng = brng.toRad();
    let lat2 = Math.asin( Math.sin(lat1)*Math.cos(d/R) + 
      Math.cos(lat1)*Math.sin(d/R)*Math.cos(brng) );
    let lon2 = lon1 + Math.atan2(Math.sin(brng)*Math.sin(d/R)*Math.cos(lat1), 
             Math.cos(d/R)-Math.sin(lat1)*Math.sin(lat2));
    return new LL(lat2.toDeg(), lon2.toDeg());
}

//Call this guy when heading text input changes -- checks
//if input is a valid number and if so,
//re-draws the bearing line
function headingOnInput(val: any): void
{
    if (!isNaN(val))
    {
        if(startMarker != null && startMarker.getPosition() != null)
        { 
            let nonNullPosition = startMarker.getPosition()!;
            drawBearingLine(nonNullPosition.lat(), nonNullPosition.lng(), parseFloat(val));
        }
        else
        {
            console.log("startMarker is null");
        }
    }
    else
    {
        console.log(`the heading specified (${val}) is not a number -- cannot draw a new heading line`);
    }
}

//save the waypoints locally as an ArduPilot waypoint file
function download(filename: string, text: string): void
{
    var element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);

    element.style.display = 'none';
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
}

//Sets up logic to allow user to upload a mission polygon file
//into the app
function setupFileListener()
{
    $('file')!.onchange = function ()
    {
        var file = this.files[0];

        var reader = new FileReader();
        reader.onload = function (progressEvent)
        {
            // Entire file
            console.log(this.result);
            var missionPolygonlls = JSON.parse(this.result);
            loadPolygonfromllJSON(missionPolygonlls);
        };
        reader.readAsText(file);
    };
    
    //This ensures the file will be imported in the event that
    //the user is re-uploading a file of the same name of the
    //file they just uploaded
    //credit: https://stackoverflow.com/questions/12030686/html-input-file-selection-event-not-firing-upon-selecting-the-same-file
    $('file')!.onclick = function () {
        this.value = null;
    };
}

function initMap()
{
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
    addStartingLocationMarker();
    setupFileListener();
}

//Increase the map zoom for fine-tuning mission location
//Credit: https://stackoverflow.com/questions/30136525/allow-further-zoom-on-google-maps-v3-satellite-view?rq=1
function setCustomZoom()
{
    zoomRangeModifier = map.__proto__.__proto__.__proto__;
    originalSetFunc = zoomRangeModifier.set;
    hijackedSetFunc = function (a, b)
    {
        if (a === 'maxZoom')
        {
            b = 25;
        }
        originalSetFunc.call(this, a, b);
    };
    zoomRangeModifier.set = hijackedSetFunc;
}

//Map karate credit to Ilya Radchenko: http://bl.ocks.org/knownasilya/89a32e572989f0aff1f8
function clearSelection()
{
    if (selectedShape)
    {
        if (selectedShape.type !== 'marker')
        {
            selectedShape.setEditable(false);
        }

        selectedShape = null;
    }
}

function setSelection(shape)
{
    if (shape.type !== 'marker')
    {
        clearSelection();
        shape.setEditable(true);
        //selectColor(shape.get('fillColor') || shape.get('strokeColor'));
    }

    selectedShape = shape;
}

//If the selected shape is the main mission polygon, present the user a 
//confirmation box just to ensure this is
//what they'd wanted to do
function confirmDeleteSelectedShape()
{
    if(selectedShape != null)
    {
        if(selectedShape == missionPolygon)
        {
            polyOptions.fillColor = '#CCCC00';
            missionPolygon.setOptions(polyOptions);
            setTimeout(confirmDeleteSelectedShapeAsync, 100);
        }
        else
        {
            deleteSelectedShape();
        }
    }
}

function confirmDeleteSelectedShapeAsync()
{
    var proceed = confirm("Main polygon is selected..are you sure?");
    polyOptions.fillColor = '#1E90FF'
    missionPolygon.setOptions(polyOptions);
    if (proceed)
    {
        deleteSelectedShape();
    } 
}

function deleteSelectedShape()
{
    if(selectedShape != null)
    {
        if (selectedShape == missionPolygon)
        {
            missionPolygon.setMap(null);
            drawingManager.setOptions({
                drawingMode: google.maps.drawing.OverlayType.POLYGON,
                drawingControl: true
            });

            if (missionPathPolyline != null) 
            {
                missionPathPolyline.setMap(null);
            }  
        }
        else
        {
            if(circleObstacles.has(selectedShape))
            {
                circleObstacles.delete(selectedShape);
            }
            if(polyObstacles.has(selectedShape))
            {
                polyObstacles.delete(selectedShape);
            }
            selectedShape.setMap(null);
        }
    }
}

function savePolygon()
{
    var lls = [];

    var polygonBounds = missionPolygon.getPath();
    // Iterate over the polygonBounds vertices.
    polygonBounds.forEach(function (xy, i)
    {
        lls.push({ lat: xy.lat(), lng: xy.lng() });
    })

    localStorage.setObject('missionPolygonlls', lls);
}

function downloadPolygon()
{
    var lls = [];
    
    if(missionPolygon)
    {
        var polygonBounds = missionPolygon.getPath();
        // Iterate over the polygonBounds vertices.
        polygonBounds.forEach(function (xy, i)
        {
            lls.push({ lat: xy.lat(), lng: xy.lng() });
        })
        var llsAsJSONString = JSON.stringify(lls);

        download("polygon.json", llsAsJSONString);
    }
}

function loadSavedPolygon()
{
    let missionPolygonlls = localStorage.getObject('missionPolygonlls');
    loadPolygonfromllJSON(missionPolygonlls);
}

function loadPolygonfromllJSON(missionPolygonlls)
{
    deleteSelectedShape();
    var pathMVCArray =  new google.maps.MVCArray<google.maps.LatLng>();
    if(missionPolygonlls)
    {
        for (var i = 0; i < missionPolygonlls.length; i++)
        {
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
        map.setOptions({draggableCursor:''});
        //addPolygonClickHandlers();
        // Add an event listener that selects the newly-drawn shape when the user
        // mouses down on it.
        google.maps.event.addListener(missionPolygon, 'click',
            function (e) 
            {
                if (e.vertex !== undefined) 
                {
                    var path = missionPolygon.getPaths().getAt(e.path);
                    path.removeAt(e.vertex);
                    if (path.getLength() < 3) 
                    {
                        missionPolygon.setMap(null);
                    }
                }
                setSelection(missionPolygon);
        });
    }
}

function selectColor(color) 
{
    selectedColor = color;
    for (var i = 0; i < colors.length; ++i) 
    {
        var currColor = colors[i];
        colorButtons[currColor].style.border = currColor == color ? '2px solid #789' : '2px solid #fff';
    }

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

function setSelectedShapeColor(color) 
{
    if (selectedShape) 
    {
        if (selectedShape.type == google.maps.drawing.OverlayType.POLYLINE) 
        {
            selectedShape.set('strokeColor', color);
        }
        else 
        {
            selectedShape.set('fillColor', color);
        }
    }
}

function makeColorButton(color) 
{
    var button = document.createElement('span');
    button.className = 'color-button';
    button.style.backgroundColor = color;
    google.maps.event.addDomListener(button, 'click',
        function () 
        {
            selectColor(color);
            setSelectedShapeColor(color);
        });
    return button;
}

function buildColorPalette() 
{
    var colorPalette = $('color-palette');
    for (var i = 0; i < colors.length; ++i) 
    {
        var currColor = colors[i];
        var colorButton = makeColorButton(currColor);
        colorPalette.appendChild(colorButton);
        colorButtons[currColor] = colorButton;
    }
    selectColor(colors[0]);
}

function postData(latLngData: string, mowingPathWidthInMeters: string)
{
    fetch(baseURL + '/missionbuilder/api/buildMissionFromLatLngPoints?mowingPathWidthInMeters='+mowingPathWidthInMeters, {
        method: 'POST',
        body: latLngData
    }).then((res) => res.json())
        .then((data) => addMissionPolylineToMap(data))
        .catch((err) => console.log("Whupps we have an error: " + err));
}

function addMissionPolylineToMap(jsonData: any): void
{
    if (missionPathPolyline != null) 
    {
        missionPathPolyline.setMap(null);
    }

    for (var x = 0; x < jsonData.length; x++)
    {
        var latLng = jsonData[x];
        console.log(`${x} Latitude: ${latLng.lat} Longitude: ${latLng.lng}`);
    }
    missionPathPolyline = new google.maps.Polyline({
        path: jsonData,
        geodesic: true,
        strokeColor: '#008000',
        strokeOpacity: 1.0,
        strokeWeight: 2,
        editable: true,
        icons: iconsequ
    });
    missionPathPolyline.setMap(map);
}

/**
 * 
 * Builds a big ArduPilot mission waypoint string that the user will be able to 
 * download as a file (and then load the file into their Flight Controller)
 * 
 * @see https://mavlink.io/en/file_formats/ For more information 
 * on the waypoint file format
 * 
 * @param waypointMVCArray Array of LatLong points arranged sequentially: i.e.
 * the first item in the array is the first waypoint 
 * and the last item is the last waypoint
 */
function buildMissionWaypointString(waypointMVCArray: google.maps.MVCArray<google.maps.LatLng>): string
{
    var missionString: string = buildWaypointFileFirstLine() + "\n";

    for(var x = 0; x < waypointMVCArray.getLength(); x++)
    {
        var lat: number = waypointMVCArray.getAt(x).lat();
        var lng: number = waypointMVCArray.getAt(x).lng();

        if(x == 0)
        {
            //Add first line twice (i.e. to set first point as home)
            missionString += buildWaypointFileLatLngLine(x, lat, lng) + "\n";
        }

        missionString += buildWaypointFileLatLngLine(x+1, lat, lng) + "\n";
    }

    return missionString;
}

//Build the standard first line of the waypoint file
function buildWaypointFileFirstLine(): string
{
    var header: string = "QGC WPL 110";
    return header;
}

//Build the standard waypoint line
function buildWaypointFileLatLngLine(index: number, lat: number, lng: number): string
{
    return index + "\t0\t3\t16\t0\t0\t0\t0\t" + lat + "\t" + lng + "\t100.000000\t1";
}

function addPolygonClickHandlers()
{
    google.maps.event.addListener(drawingManager, 'overlaycomplete',
        function (e) 
        {
            var newShape = e.overlay;

            newShape.type = e.type;

            if (e.type !== google.maps.drawing.OverlayType.MARKER) 
            {
                // Switch back to non-drawing mode after drawing a shape.
                drawingManager.setDrawingMode(null);

                // Add an event listener that selects the newly-drawn shape when the user
                // mouses down on it.
                google.maps.event.addListener(newShape, 'click',
                    function (e) 
                    {
                        if (e.vertex !== undefined) 
                        {
                            if (newShape.type === google.maps.drawing.OverlayType.POLYGON) 
                            {
                                var path = newShape.getPaths().getAt(e.path);
                                path.removeAt(e.vertex);
                                if (path.length < 3) 
                                {
                                    newShape.setMap(null);
                                }
                            }
                            if (newShape.type === google.maps.drawing.OverlayType.POLYLINE) 
                            {
                                var path = newShape.getPath();
                                path.removeAt(e.vertex);
                                if (path.length < 2) 
                                {
                                    newShape.setMap(null);
                                }
                            }
                        }
                        setSelection(newShape);
                    });
                setSelection(newShape);
            }
            else 
            {
                google.maps.event.addListener(newShape, 'click',
                    function (e) 
                    {
                        setSelection(newShape);
                    });
                setSelection(newShape);
            }
        }
    );
}

//Add a generic polygon-shaped area to the center of the map -- the idea
//is that users will move and reshape the polygon over
//areas that they want their mower to avoid
function addPolyObstacle()
{
    var polyCoords = [
        {lat: map.getCenter().lat() + .00002, lng: map.getCenter().lng() - .00002},
        {lat: map.getCenter().lat() + .00002, lng: map.getCenter().lng() + .00002},
        {lat: map.getCenter().lat() - .00002, lng: map.getCenter().lng() + .00002},
        {lat: map.getCenter().lat() - .00002, lng: map.getCenter().lng() - .00002}
    ];
    //add obstacle to visible center of map
    var polyObstacle = new google.maps.Polygon({
        map: map,
        paths: polyCoords,
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

    google.maps.event.addListener(polyObstacle, 'click',
        function (e) 
        {
            setSelection(polyObstacle);
        });
    
    setSelection(polyObstacle);

    polyObstacles.add(polyObstacle);
}

//Add a generic circle-shaped area to the center of the map -- the idea
//is that users will move and reshape the circle over
//areas that they want their mower to avoid
function addCircleObstacle()
{
    var circleObstacle = new google.maps.Circle({
        strokeColor: '#FF0000',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: '#FF0000',
        fillOpacity: 0.35,
        map: map,
        center: map.getCenter(),
        radius: 2,
        draggable: true,
        editable: true,
        zIndex: 100
        });
    
    google.maps.event.addListener(circleObstacle, 'click',
        function (e) 
        {
            setSelection(circleObstacle);
        });
    
    setSelection(circleObstacle);

    circleObstacles.add(circleObstacle);
}

//Add drawing tools (i.e. that user will use to draw mission) to map
function addDrawingToolsToMap(): void
{
    // Creates a drawing manager attached to the map that allows the user to draw
    // markers, lines, and shapes.
    drawingManager = new google.maps.drawing.DrawingManager(
        {
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
    google.maps.event.addDomListener(<HTMLButtonElement> $('deleteBtn'), 'click', confirmDeleteSelectedShape);
    google.maps.event.addDomListener(<HTMLButtonElement> $('savePolygonBtn'), 'click', savePolygon);
    google.maps.event.addDomListener(<HTMLButtonElement> $('loadPolygonBtn'), 'click', loadSavedPolygon);
    google.maps.event.addDomListener(<HTMLButtonElement> $('downloadPolygonBtn'), 'click', downloadPolygon);
    google.maps.event.addDomListener(<HTMLButtonElement> $('addCircleObstacleBtn'), 'click', addCircleObstacle);
    google.maps.event.addDomListener(<HTMLButtonElement> $('addPolyObstacleBtn'), 'click', addPolyObstacle);

    buildColorPalette();

    google.maps.event.addListener(drawingManager, 'polygoncomplete', function (polygon)
    {
        missionPolygon = polygon;
        drawingManager.setOptions({
            drawingControl: false
        });
    });

    google.maps.event.addDomListener(<HTMLButtonElement> $('downloadWaypointsBtn'), 'click', function ()
    {
        if(missionPathPolyline != null)
        {
            var missionWaypointString = buildMissionWaypointString(missionPathPolyline.getPath());
            download("mission.waypoints", missionWaypointString);
        }
    });

    google.maps.event.addDomListener(<HTMLButtonElement> $('buildMissionBtn'), 'click', function ()
    {
        let missionPolygonLatLng: Array<LL>  = [];

        var polygonBounds = missionPolygon.getPath();
        // Iterate over the polygonBounds vertices.
        polygonBounds.forEach(function (xy, i)
        {
            missionPolygonLatLng.push({ lat: xy.lat(), lng: xy.lng() });
        });

        var latLngBoundsString = JSON.stringify(missionPolygonLatLng);
        console.log(latLngBoundsString);

        var polyArray: Array<Array<LL>> = [];
        polyObstacles.forEach(function (poly, i)
        {
            var polyObstacleBoundsArray: Array<LL> = [];
            poly.getPath().forEach(function (xy, i)
            {
                polyObstacleBoundsArray.push(new LL(xy.lat(), xy.lng())); 
            });
            polyArray.push(polyObstacleBoundsArray);
        });

        var circleArray : Array<LL> = [];
        circleObstacles.forEach(function (circle, i)
        {
            //Begin treating these guys as true circles
            // var circleObstacleMap = new Map();
            // var center = circle.getCenter();
            // var radius = circle.getRadius();
            // circleObstacleMap['radius'] = radius;
            // circleObstacleMap['lat'] = center.lat();
            // circleObstacleMap['lng'] = center.lng();
            // circleArray.push(circleObstacleMap);
            //End treating as true circles

            var circleAsLagLngArray: Array<LL> = approximateCircleAsPolygon(circle.getCenter(), circle.getRadius(), 18);
            polyArray.push(circleAsLagLngArray);
        });

        var truckLoadOfDataForServer: Record<string, any> = {
            'missionPolygon': missionPolygonLatLng,
            'circleObstacles': circleArray,
            'polyObstacles': polyArray,
            'mowingPathWidthInMeters': (<HTMLInputElement> $('pathWidth')).value,
            'heading': (<HTMLInputElement> $('heading')).value
        };

        let pathWidthStr: string = (<HTMLInputElement> $('pathWidth')).value;
        //Now we want to send this data up to the server
        postData(JSON.stringify(truckLoadOfDataForServer), pathWidthStr);
        saveMapLocationToCookie();
    });

} //End function addDrawingToolsToMap

//Approximate circle as polygon
//Returns [{lat: , lng:}, {lat: , lng}, ...]
//Credit: https://stackoverflow.com/questions/24733481/how-to-draw-a-circle-using-polygon-in-googlemaps
function approximateCircleAsPolygon(center: google.maps.LatLng, radius: number, points: number): Array<LL>
{
    let llArray: Array<LL> = [];
    let p: number = 360/points;
    let d: number = 0;

    for(var i=0; i<points;++i, d+=p)
    {
        var offsetLatLng: google.maps.LatLng = google.maps.geometry.spherical.computeOffset(center,radius,d);
        llArray.push(new LL(offsetLatLng.lat(), offsetLatLng.lng())); 
    }
    return llArray;
}

//Maps save location logic credit: https://www.daftlogic.com/sandbox-google-maps-remember-last-location.htm
function saveMapLocationToCookie(): void
{
    let mapzoom = map.getZoom();
    let mapcenter = map.getCenter();
    let maplat = mapcenter.lat();
    let maplng = mapcenter.lng();
    let maptypeid = map.getMapTypeId();

    let cookiestring: string = maplat + "_" + maplng + "_" + mapzoom + "_" + maptypeid;
    let exp = new Date();     //set new date object
    exp.setTime(exp.getTime() + (1000 * 60 * 60 * 24 * 30));     //set it 30 days ahead
    setCookie("GoogleMapsLocation", cookiestring, exp);
}

function loadMapLocationFromCookie(): void
{
    let loadedstring: string = getCookie("GoogleMapsLocation");
    if (loadedstring)
    {
        let splitstr: string[] = loadedstring.split("_");
        let latlng: google.maps.LatLng = new google.maps.LatLng(parseFloat(splitstr[0]), parseFloat(splitstr[1]));
        
        let savedMapZoom: number = parseFloat(splitstr[2]);
        
        //If we don't scale-back the zoom when the user loads the page
        //they may get a gray screen that's basically non-operable (i.e.
        //unless they know to start zooming out)
        if(savedMapZoom > 21.0)
        {
            savedMapZoom = 21.0;
        }

        map.setCenter(latlng);
        map.setZoom(savedMapZoom);
        map.setMapTypeId(splitstr[3])
    }
    else
    {
        //baswell begin testing
        var latlng = new google.maps.LatLng(30.563413767103118, -87.67843377406932);
        map.setCenter(latlng);
        map.setZoom(21);
        map.setMapTypeId("hybrid")
        //baswell end testing
    }
}

function setCookie(name: string, value: string, expires: Date): void
{
    document.cookie = name + "=" + escape(value) + "; path=/" + ((expires == null) ? "" : "; expires=" + expires.toUTCString());
}

function getCookie(name: string): string
{
    if (document.cookie.length > 0)
    {
        let cStart: number = document.cookie.indexOf(name + "=");
        if (cStart != -1)
        {
            cStart = cStart + name.length + 1;
            let cEnd: number = document.cookie.indexOf(";", cStart);
            if (cEnd == -1) cEnd = document.cookie.length;
            return unescape(document.cookie.substring(cStart, cEnd));
        }
    }
    return "";
}

// Adds a marker to the map.
function addStartingLocationMarker(heading: number): void
{
    startMarker = new google.maps.Marker({
        position: map.getCenter(),
        label: 'Go',
        title: 'Location where robot begins mission',
        draggable: true,
        map: map
    });

    var bearingEndPointLatLong: LL = bearingLineEndpointCoords(map.getCenter().lat(), map.getCenter().lng(), heading);

    var bearingLineCoordinates = [
        {lat: map.getCenter().lat(), lng: map.getCenter().lng()},
        {lat: bearingEndPointLatLong.lat, lng: bearingEndPointLatLong.lng}
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

//Draw the bearing line on the map -- the "bearing" we're talking about
//here is the heading of the up-and-down (or side-to-side) mission
function drawBearingLine(latStart: number, lngStart: number, heading: number): void
{
    var bearingEndPointLatLong: LL = bearingLineEndpointCoords(latStart, lngStart, heading);
    var bearingLineCoordinates = [
        {lat: latStart, lng: lngStart},
        {lat: bearingEndPointLatLong.lat, lng: bearingEndPointLatLong.lng}
    ];
    bearingLine.setPath(bearingLineCoordinates);
}

//When user drags the startMarker around, update the bearing line
//to "attach" to the startMarker
function startMarkerMovedRedrawHeadingListener(): void
{
    google.maps.event.addListener(startMarker, 'dragend', function(evt){
        let inputValue = (<HTMLInputElement> $('heading')).value;
        drawBearingLine(evt.latLng.lat(), evt.latLng.lng(), parseFloat(inputValue));
    });

    google.maps.event.addListener(startMarker, 'drag', function(evt){
        let inputValue = (<HTMLInputElement> $('heading')).value;
        drawBearingLine(evt.latLng.lat(), evt.latLng.lng(), parseFloat(inputValue));
    }); 
}