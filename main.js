/* Team Sidney Light Controller - Main Javascript code */

/* Firebase rules are set up to allow public REST access to read
 * the strips entries in the database. The value of a strip with
 * ID "strip3" can be accessed via:
 * 
 * https://team-sidney.firebaseio.com/strips/strip3.json
 *
 * which returns a JSON-encoded string for the value (e.g., "Off"), with
 * the quotes around it.
 */

/* Set to true to stub out authentication code. */
var FAKE_AUTH = false;
var SIDNEY_PHOTO = "http://howtoprof.com/profsidney.jpg";
var provider = new firebase.auth.GoogleAuthProvider();
var fakeUser = null;

// Mapping from strip-ID to object maintaining strip state.
var allStrips = {};

// List of supported modes.
var allmodes = [
  'off',
  'random',
  'wipe',
  'theater',
  'bounce',
  'rainbow',
  'rainbowcycle',
  'spackle',
  'fire',
  'strobe',
  'rain',
  'comet',
];

// Global variables to be maintained in Firebase.
var globals = {};

// Known firmware versions.
var firmwareVersions = {};

// Database references.
var logRef = null;
var globalsRef = null;
var firmwareVersionsRef = null;

// Initialize click handlers.
$('#login').off('click');
$('#login').click(doLogin);
$('#logout').off('click');
$('#logout').click(logout);
$('#enableAll').change(enableAllToggled);

initEditor();
setup();

// MDW TESTING STORAGE STUFF
var storage = firebase.storage();
var storageRef = storage.ref();
var fwRef = storageRef.child('Blinky.ino.bin');
var fwUrl = fwRef.getDownloadURL().then(function(fwUrl) {
  console.log('Firmware URL: ');
  console.log(fwUrl);

  var xhr = new XMLHttpRequest();
  xhr.responseType = 'arraybuffer';
  xhr.onload = function(event) {
    var arrayBuffer = xhr.response;
    var byteArray = new Uint8Array(arrayBuffer);
    console.log('Received:');
    console.log(byteArray);
    var enc = new TextDecoder("utf-8");
    var s = enc.decode(byteArray);
    var re = new RegExp("__Bl!nky__ [^_]+ ___");
    var result = re.exec(s);
    console.log("Matched:");
    console.log(result[0]); // MDW THIS IS IT!!!
  };
  xhr.open('GET', fwUrl);
  xhr.send();
  console.log('Done with fw fetch');

  var reader = new FileReader();

});

function initEditor() {
  var editor = $("#editorMode");

  // Populate mode dropdown.
  var select = $("#editorModeSelect");
  allmodes.forEach(function(mode) {
    $('<option/>')
      .text(mode)
      .appendTo(select);
  });
  
  // Fix up UI components for the rest of the editor.
  $("#editorSpeedSlider").slider({
    orientation: "horizontal",
    range: "min",
    min: 0,
    max: 200,
    value: 100,
    slide: refreshSwatch,
    change: refreshSwatch
  });
  $("#editorBrightnessSlider").slider({
    orientation: "horizontal",
    range: "min",
    min: 0,
    max: 255,
    value: 128,
    slide: refreshSwatch,
    change: refreshSwatch
  });
  $("#red, #green, #blue").slider({
    orientation: "horizontal",
    range: "min",
    max: 255,
    value: 127,
    slide: refreshSwatch,
    change: refreshSwatch
  });
  $("#editorColorChangeSlider").slider({
    orientation: "horizontal",
    range: "min",
    min: 0,
    max: 100,
    value: 0,
    slide: refreshSwatch,
    change: refreshSwatch
  });
  $("#editorNumPixelsSlider").slider({
    orientation: "horizontal",
    range: "min",
    min: 100,
    max: 200,
    value: 120,
    slide: refreshSwatch,
    change: refreshSwatch
  });
  refreshSwatch();

  // Handle editor completion.
  $('#editorSave').click(function (e) {
    console.log('Editor save clicked');
    $("#editor").modal('hide');
    editStripDone();
  });

  // Handle deletion completion.
  $('#deleteStripConfirm').click(function (e) {
    $("#deleteStrip").modal('hide');
    deleteStripDone();
  });
}

// Called when editor opened for a strip.
function editStripStart(id) {
  console.log('editStripStart: ' + id);
  var strip = allStrips[id];
  if (strip == null) {
    console.log("Warning - editing unknown strip " + id);
    return;
  }
  $("#editorStripId").text(id);

  // Populate firmware version dropdown.
  var fwselect = $("#editorFirmwareSelect");
  fwselect.empty();
  for (var fw in firmwareVersions) {
    console.log('Adding fw to editor: ' + fw);
    $('<option/>')
      .text(fw)
      .appendTo(fwselect);
  }

  // Prefer initializing dialog to nextConfig if it exists, otherwise
  // fall back to curConfig.
  var config = null;
  if (strip.nextConfig == null) {
    if (strip.curConfig == null) {
      console.log("Warning - no cur or next config for strip yet: " + id);
      return;
    } else {
      console.log("Using cur config");
      config = strip.curConfig;
    }
  } else {
    console.log("Using next config");
    config = strip.nextConfig;
  }
  console.log(config);

  $("#editorNameField").val(config.name);
  $("#editorModeSelect").val(config.mode);
  $("#editorSpeedSlider").slider("value", config.speed);
  $("#editorBrightnessSlider").slider("value", config.brightness);
  $("#editorColorChangeSlider").slider("value", config.colorChange);
  if (config.numPixels != undefined) {
    $("#editorNumPixelsSlider").slider("value", config.numPixels);
  }
  $("#red").slider("value", config.red);
  $("#green").slider("value", config.green);
  $("#blue").slider("value", config.blue);
}

// Called when editing done.
function editStripDone() {
  var id = $("#editorStripId").text();
  var strip = allStrips[id];
  if (strip == null) {
    console.log("Can't edit unknown strip: " + id);
    return;
  }

  // Extract values from modal.
  var name = $("#editorNameField").val();
  var version = $("#editorFirmwareSelect").find(':selected').text();
  var mode = $("#editorModeSelect").find(':selected').text();
  var speed = $("#editorSpeedSlider").slider("value");
  var brightness = $("#editorBrightnessSlider").slider("value");
  var colorChange = $("#editorColorChangeSlider").slider("value");
  var numPixels = $("#editorNumPixelsSlider").slider("value");
  var red = $("#red").slider("value");
  var green = $("#green").slider("value");
  var blue = $("#blue").slider("value");
  var newConfig = {
    version: version,
    name: name,
    mode: mode,
    speed: speed,
    brightness: brightness,
    colorChange: colorChange,
    numPixels: numPixels,
    red: red,
    green: green,
    blue: blue,
  };
  console.log('New config: ' + JSON.stringify(newConfig));
  setConfig(id, newConfig);
}

// Color picker.
function hexFromRGB(r, g, b) {
  var hex = [
    r.toString( 16 ),
    g.toString( 16 ),
    b.toString( 16 )
  ];
  $.each(hex, function( nr, val) {
    if ( val.length === 1 ) {
      hex[nr] = "0" + val;
    }
  });
  return hex.join( "" ).toUpperCase();
}

function refreshSwatch() {
  var red = $("#red").slider("value");
  var green = $("#green").slider("value");
  var blue = $("#blue").slider("value");
  var hex = hexFromRGB(red, green, blue);
  $("#swatch").css("background-color", "#" + hex);

  var speed = $("#editorSpeedSlider").slider("value");
  $("#speedIndicator").text(speed);
  var brightness = $("#editorBrightnessSlider").slider("value");
  $("#brightnessIndicator").text(brightness);
  var colorChange = $("#editorColorChangeSlider").slider("value");
  $("#colorChangeIndicator").text(colorChange);
  var numPixels = $("#editorNumPixelsSlider").slider("value");
  $("#numPixelsIndicator").text(numPixels);
}

// Set up initial UI elements.
function setup() {
  if (currentUser() == null) {
    // Not logged in yet.
    showLoginButton();
    logRef = null;
    globalsRef = null;
    firmwareVersionsRef = null;

  } else {
    showFullUI();

    checkinRef = firebase.database().ref('checkin/');
    checkinRef.on('child_added', stripCheckin, dbErrorCallback);
    checkinRef.on('child_changed', stripCheckin, dbErrorCallback);

    logRef = firebase.database().ref('log/');
    logRef.on('child_added', newLogEntry, dbErrorCallback);

    globalsRef = firebase.database().ref('globals/');
    globalsRef.on('value', globalsChanged, dbErrorCallback);

    firmwareVersionsRef = firebase.database().ref('firmware/');
    firmwareVersionsRef.on('child_added', newFirmwareVersion, dbErrorCallback);
    firmwareVersionsRef.on('child_changed', newFirmwareVersion, dbErrorCallback);
  }
}

// Called when globals/ DB entry changes.
function globalsChanged(snapshot) {
  globals = snapshot.val();
  console.log('Received new globals:');
  console.log(globals);

  // Update UI.
  $('#enableAll').prop('checked', globals.allEnabled);

  // Note that any changes to the configs is done when the button is toggled.
}

// Called when firmware/ DB entry changes.
function newFirmwareVersion(snapshot) {
  var fwVersion = snapshot.key;
  var fwData = snapshot.val();
  console.log('Adding new firmware version: ' + fwVersion);
  console.log(fwData);
  firmwareVersions[fwVersion] = fwData;
}

function currentUser() {
  if (FAKE_AUTH) {
    return fakeUser;
  } else {
    return firebase.auth().currentUser;
  }
}

// Called when there is an error reading the database.
function dbErrorCallback(err) {
  // Ignore the error if not logged in yet.
  if (currentUser() != null) {
    showError($('#dberror'), err.message);
  }
}

// Clear error.
function clearError(elem) {
  elem.text('');
  elem.hide();
}

// Show error.
function showError(elem, msg) {
  elem.text(msg);
  elem.show();
}

// Show the login button.
function showLoginButton() {
  $('#login').show();
  $('#postlogin').hide();
  $('#logout').hide();
}

function doLogin() {
  if (FAKE_AUTH) {
    fakeUser = {
      displayName: "Fakey McFakerson",
      photoURL: SIDNEY_PHOTO,
      email: "fake@teamsidney.com",
    };
    showFullUI();
  } else {
    firebase.auth().signInWithPopup(provider).then(function(result) {
    }).catch(function(error) {
      showError($('#loginerror'),
                'Sorry, could not log you in: ' + error.message);
    });
  }
}

// Show the full UI.
function showFullUI() {
  // Update header.
  $('#login').hide();
  $('#logout').show();

  $('#about').hide();
  $('#postlogin').hide('blind');

  $("#log").empty();
  $("#striplist").empty();

  // Show it.
  $('#postlogin').show('fade', 1000);
}

// Callback invoked when database returns new value for a strip.
function stripCheckin(snapshot) {
  console.log('Strip checkin with key ' + snapshot.key);
  var stripid = snapshot.key;
  updateStrip(stripid, snapshot.val());
}

// Update the local strip state with the received data from checkin.
function updateStrip(id, stripdata) {
  console.log('updateStrip for ' + id);
  console.log(stripdata);

  var strip = allStrips[id];
  if (strip == null) {
    // This is a new strip.
    strip = createStrip(id);
    if (strip == null) {
      console.log('Bug - Unable to create strip ' + id);
      return;
    }
  }

  // Update local state.
  console.log("Setting strip config to: " + JSON.stringify(stripdata.config));
  strip.curConfig = stripdata.config;
  strip.ip = stripdata.ip;
  strip.rssi = stripdata.rssi;
  strip.lastCheckin = new Date(stripdata.timestamp);
  strip.version = stripdata.version;

  // Now update the UI.
  var e = strip.stripElem;
  $(e).effect('highlight');

  var mode = "unknown";
  if (stripdata.config != null && stripdata.config.mode != null) {
    mode = stripdata.config.mode;
  }
  $(e).find('#curMode').text(configToString(stripdata.config));

  if (JSON.stringify(strip.curConfig) === JSON.stringify(strip.nextConfig)) {
    $(e).find("#nextMode").removeClass('pending');
  } else {
    $(e).find("#nextMode").addClass('pending');
  }
  $(e).find('#ip').text(stripdata.ip);
  $(e).find('#version').text(stripdata.version);
  $(e).find('#rssi').text(stripdata.rssi + ' dBm');
  var m = new moment(strip.lastCheckin);
  dateString = m.format('MMM DD, h:mm:ss a') + ' (' + m.fromNow() + ')';
  $(e).find('#checkin').text(dateString);
}

// Create a strip with the given ID.
function createStrip(id) {
  console.log('Creating strip ' + id);

  console.log('Registering database ref for strip ' + id);
  var dbRef = firebase.database().ref('strips/' + id);
  dbRef.on('value', configUpdate, dbErrorCallback);

  var strip = {
    id: id,
    stripElem: strip,
    dbRef: dbRef,
    curConfig: {
      mode: "unknown",
      enabled: false,
    },
    nextConfig: {
      mode: "unknown",
      enabled: false,
    },
  };
  allStrips[id] = strip;

  var container = $('#striplist');
  strip.stripElem = $('<div/>')
    .addClass('card')
    .addClass('list-group-item')
    .attr('id', 'stripline-strip-'+id)
    .appendTo(container);
  var cardbody = $('<div/>')
    .addClass('card-body')
    .appendTo(strip.stripElem);
  var cardtitle = $('<div/>')
    .addClass('card-title')
    .appendTo(cardbody);

  var s = $('<span/>')
    .addClass('h5')
    .text(id)
    .appendTo(cardtitle);

  var f = $('<form/>').appendTo(cardtitle);
  var s = $('<div/>')
    .addClass('switch')
    .appendTo(f);
  var lbl = $('<label/>')
     .text('Enabled')
     .appendTo(s);
  var inp = $('<input/>')
    .attr('type', 'checkbox')
    .prop('checked', true)
    .appendTo(lbl);

  // Status area.
  var statusArea = $('<div/>')
    .addClass('container')
    .appendTo(cardbody);

  var tbl = $('<table/>')
    .addClass('table')
    .addClass('table-sm')
    .appendTo(statusArea);

  var tbody = $('<tbody/>')
    .appendTo(tbl);

  r0 = $('<tr/>')
    .appendTo(tbody);
  $('<td/>')
    .text('Name')
    .appendTo(r0);
  $('<td/>')
    .attr('id', 'name')
    .text('unknown')
    .appendTo(r0);

  r0 = $('<tr/>')
    .appendTo(tbody);
  $('<td/>')
    .text('Last checkin')
    .appendTo(r0);
  $('<td/>')
    .attr('id', 'checkin')
    .text('unknown')
    .appendTo(r0);

  r0 = $('<tr/>')
    .appendTo(tbody);
  $('<td/>')
    .text('Firmware version')
    .appendTo(r0);
  $('<td/>')
    .attr('id', 'version')
    .text('unknown')
    .appendTo(r0);

  r0 = $('<tr/>')
    .appendTo(tbody);
  $('<td/>')
    .text('IP address')
    .appendTo(r0);
  $('<td/>')
    .attr('id', 'ip')
    .text('unknown')
    .appendTo(r0);
  
  r0 = $('<tr/>')
    .appendTo(tbody);
  $('<td/>')
    .text('RSSI')
    .appendTo(r0);
  $('<td/>')
    .attr('id', 'rssi')
    .text('unknown')
    .appendTo(r0);

  var r0 = $('<tr/>')
    .appendTo(tbody);
  $('<td/>')
    .text('Current config')
    .appendTo(r0);
  $('<td/>')
    .attr('id', 'curMode')
    .text('unknown')
    .appendTo(r0);

  r0 = $('<tr/>')
    .appendTo(tbody);
  $('<td/>')
    .text('Next config')
    .appendTo(r0);
  var nme = $('<td/>')
    .appendTo(r0);
  $('<span/>')
    .attr('id', 'nextMode')
    .text('unknown')
    .appendTo(nme);

  // Button group.
  var bg = $('<div/>')
    .addClass('container')
    .addClass('btn-group')
    .attr('role', 'group')
    .appendTo(cardbody);

  var edit = $('<button/>')
    .attr('type', 'button')
    .attr('data-toggle', 'modal')
    .attr('data-target', '#editor')
    .attr('aria-expanded', 'false')
    .attr('aria-controls', 'editor')
    .addClass('btn')
    .addClass('btn-primary')
    .addClass('btn-raised')
    .text('edit')
    .click(function() {
      editStripStart(id);
    })
    .appendTo(bg);

  $('<button/>')
    .attr('type', 'button')
    .addClass('btn')
    .addClass('btn-secondary')
    .addClass('material-icons')
    .text('refresh')
    .appendTo(bg);

  $('<button/>')
    .attr('type', 'button')
    .attr('data-toggle', 'modal')
    .attr('data-target', '#deleteStrip')
    .attr('aria-expanded', 'false')
    .attr('aria-controls', 'deleteStrip')
    .addClass('btn')
    .addClass('btn-secondary')
    .addClass('material-icons')
    .text('delete')
    .click(function() {
      deleteStripStart(id);
    })
    .appendTo(bg);
  
  return strip;
}

// Called when modal opened for deleting a strip.
function deleteStripStart(id) {
  $("#deleteStripId").text(id);
}

// Called when modal closed for deleting a strip.
function deleteStripDone() {
  var id = $("#deleteStripId").text();
  var strip = allStrips[id];
  if (strip == null) {
    console.log("Can't delete unknown strip: " + id);
    return;
  }
  deleteStrip(id);
}

function deleteStrip(id) {
  console.log("Deleting strip: " + id);

  var strip = allStrips[id];
  if (strip == null) {
    console.log('No such strip to delete: ' + id);
    return;
  }

  // Remove checkin state.
  cref = firebase.database().ref('checkin/' + id);
  cref.remove()
    .then(function() {
      // Remove strip config state.
      strip.dbRef.remove()
        .then(function() {
          document.getElementById("stripline-strip-"+id).remove();
          allStrips[id] = null;
          addLogEntry("deleted strip " + id);
      });
    });
}

function configToString(config) {
  if (config == undefined || config == null) {
    return "not yet known";
  }
  var s = 
    config.numPixels + " pixels, " +
    "enabled: " + config.enabled +
    ", mode: " + config.mode +
    ", speed: " + config.speed +
    ", bright: " + config.brightness +
    ", color: (" + config.red + "," + config.green + "," + config.blue + ")" +
    ", color change: " + config.colorChange;
  return s;
}

// Callback invoked when strip's config has changed from the DB.
function configUpdate(snapshot) {
  console.log('configUpdate called for key ' + snapshot.key);
  var stripid = snapshot.key;
  var nextConfig = snapshot.val();
  console.log('got nextConfig:');
  console.log(nextConfig);

  var strip = allStrips[stripid];
  if (strip == null) {
    console.log('configUpdate bailing out as strip is not known yet: ' + stripid);
    return;
  }
  var e = strip.stripElem;
  strip.nextConfig = nextConfig;
  var nme = $(e).find("#nextMode");
  $(nme).text(configToString(nextConfig));
  if (JSON.stringify(strip.curConfig) === JSON.stringify(nextConfig)) {
    $(nme).removeClass('pending');
  } else {
    $(nme).addClass('pending');
  }
  $(nme).effect('highlight');
  $(e).find("#name").text(nextConfig.name);
}

// Set the strip's config in the database.
function setConfig(stripid, config) {
  // Here we grab the global enabled flag and set it in the config.
  config.enabled = $('#enableAll').is(':checked');

  console.log('Setting config of ' + stripid + ' to ' + JSON.stringify(config));
  var strip = allStrips[stripid];
  if (strip == null) {
    return;
  }

  // Write current config to the database.
  strip.dbRef.set(config)
    .then(function() {
      addLogEntry('set ' + strip.id + ' to ' + JSON.stringify(config));
    })
    .catch(function(error) {
      showError($('#dberror'), error.message);
    });
}

// Add a new log entry to the database.
function addLogEntry(text) {
  var logRef = firebase.database().ref('log/');
  var entry = logRef.push();
  entry.set({
    'date': new Date().toJSON(),
    'name': currentUser().displayName,
    'text': text,
  });

  if (FAKE_AUTH) {
    showLogEntry(new Date(), currentUser().displayName, text);
  }
}

// Callback invoked when new log entry hits the database.
function newLogEntry(snapshot, preChildKey) {
  clearError($('#dberror'));
  var entry = snapshot.val();
  showLogEntry(new Date(entry.date), entry.name, entry.text);
}

// Show a log entry.
function showLogEntry(date, name, text) {
  var container = $('#log');
  var line = $('<div/>').addClass('log-line').prependTo(container);

  // Log entry.
  var entry = $('<div/>').addClass('log-line-entry').appendTo(line);

  var m = new moment(date);
  var dateString = m.format("ddd, h:mmA");

  $('<span/>')
    .addClass("log-line-date")
    .text(dateString)
    .appendTo(entry);
  $('<span/>')
    .addClass("log-line-name")
    .text(name)
    .appendTo(entry);
  $('<span/>')
    .addClass("log-line-text")
    .text(text)
    .appendTo(entry);
  entry.effect('highlight');
}

function logout() {
  firebase.auth().signOut().then(function() {
    setup(); // Get back to initial state.
  }, function(error) {
    console.log('Problem logging out: ' + error.message);
  });
}

// Callback when signin complete.
firebase.auth().onAuthStateChanged(function(user) {
  setup();
});

// Callback when "Enable all" checkbox is toggled.
function enableAllToggled() {
  var cb = $('#enableAll');

  // Write new globals to the database.
  var newGlobals = {
    allEnabled: cb.is(':checked'),
  };
  globalsRef.set(newGlobals)
    .catch(function(error) {
      showError($('#dberror'), error.message);
    });

  // We don't want to modify the strip configs in the database update callback,
  // since that is also triggered when we first load the page (and we may not
  // have knowledge of the config yet). Here we update
  // the config for each strip that we know about with the new value.
  $.each(allStrips, function(id, strip) {
    var cfg = strip.nextConfig;
    strip.nextConfig.enabled = newGlobals.allEnabled;
    setConfig(id, strip.nextConfig);
  });

}
