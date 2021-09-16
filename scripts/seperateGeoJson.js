const path = require('path');
const fs = require('fs-extra');
const shapefile = require("shapefile");
const ora = require('ora');
const gk = require('gauss-krueger')

const TYPE_DEFINITIONS = require('./typesDefinitions.json');

/**
 * Read shapefile data and return geo-json
 * 
 * @param {*} shp link to SHP file
 * @param {*} dbf link to DBF file
 */
async function _getGeoJson(shp, dbf) {
	try {
		const geojson = await shapefile.read( shp, dbf, {
			encoding: "utf-8"
		});

		// cleanup broken data
		geojson.features = geojson.features.map(feature => {
			feature.properties.LAGE = feature.properties.LAGE || "UNKNOWN";
			feature.properties.Typ = feature.properties.Typ || "UNKNOWN";
			return feature;
		});

		return geojson;
	} catch(err) {
		throw new Error(`Error parsing shape filea: ${err}`);
	}
}

/**
 * Save geo-json data to the given filename.
 * 
 * @param {*} outputFileName output file name (with path)
 * @param {*} geojson geo-json data object
 */
async function _saveGeoJson(outputFileName, geojson) {
	// save geojson to file
	const geojsonString = JSON.stringify(geojson, null, '\t');
	await fs.writeFile(`${outputFileName}.geojson`, geojsonString, {
		encoding: 'utf-8'
	});
}

/**
 * Shapefile to geojson.
 * 
 * @param {*} inputFileName filepath to shapefiles (*.shp, *.dbf)
 * @param {*} outputFileName path of output geo-json
 * @param {*} typesDefinitions
 */
async function shapeToGeojson(options) {
	const spinner = ora('shapeToGeojson').start();

	const {
		inputFileName,
		outputFileName,
		typesDefinitions
	} = Object.assign({
		typesDefinitions: []
	}, options);

	const TYPES = typesDefinitions.map(t => t.type);
	const DESIGNATIONS = [...new Set(typesDefinitions.map(t => t.designation))];

	spinner.text = `reading geo-json from "${inputFileName}"`;
	let geojson;
	try {
		geojson = await _getGeoJson(
			path.resolve(__dirname, inputFileName + '.shp'), 
			path.resolve(__dirname, inputFileName + '.dbf'));
	} catch(err) {
		return spinner.fail(`ERROR reading geo-json: ${err}`);
	}

	// extract types from feature-list
	let types = new Set();
	geojson.features = geojson.features.map((feature) => {
		const type = feature.properties.Typ;
		if (TYPES.length) {
			if (type && TYPES.includes(type)) {
				spinner.text = `Valid type found: "${type}"`;
				const typeDefinition = typesDefinitions.find(t => t.type === type);
				if (typeDefinition) {
					feature.properties.designation = typeDefinition.designation;
				} else {
					return spinner.fail(`type defintion for type "${type}" not found!`);
				}
				types.add(type);
			} else if (type) {
				spinner.warn(`Unknown type found: "${type}". Please change/extend the typesDefinition`);
			} else {
				spinner.error(`Invalid type "${type}" found in "${feature.properties.LAGE}".`);
			}
		}
		return feature;
	});

	// convert WGS to wgs84 (Only if data is in "DHDN_3_Degree_Gauss_Zone_4" format!)
	geojson.features = geojson.features.map(feature => {
		feature.geometry.coordinates = feature.geometry.coordinates.map(coordinates => {
			const wgs = gk.toWGS({ x: coordinates[0], y: coordinates[1] });
			return [
				wgs.longitude,
				wgs.latitude
			];
		})
		return feature;
	});
	geojson.bbox = [
		gk.toWGS({x: geojson.bbox[0], y: geojson.bbox[1]}).latitude,
		gk.toWGS({x: geojson.bbox[0], y: geojson.bbox[1]}).longitude,
		gk.toWGS({x: geojson.bbox[2], y: geojson.bbox[3]}).latitude,
		gk.toWGS({x: geojson.bbox[2], y: geojson.bbox[3]}).longitude,
	];

	// generate seperate files for each destination
	for (let designation of DESIGNATIONS) {
		spinner.text = `processing designation "${designation}"`;
		const features = JSON.parse(JSON.stringify(geojson.features)).filter(f => {
			return (f.properties && f.properties.designation === designation);
		});
		try {
			const outputFile = `${outputFileName}_${designation}`
			await _saveGeoJson(outputFile, {
				type: geojson.type,
				features: features,
				bbox: geojson.bbox
			});
			spinner.text = `successfully wrote geo-json file "${outputFile}"`;
		} catch(err) {
			return spinner.fail(`ERROR saving geo-json to file "${outputFile}"`);
		}
	}

	// save geojson to file
	try {
		await _saveGeoJson(outputFileName, geojson);
		spinner.succeed(`shapeToGeojson: geo-data wrote to "${outputFileName}"`);
	} catch(err) {
		return spinner.fail(`ERROR saving geo-json to file "${outputFileName}"`);
	}
}

(async () => {
	/* create geo-json from sources */
	// await shapeToGeojson({
	// 	inputFileName: '../data/Abstellanlagen/Abstellanlagen_Fuerth',
	// 	outputFileName: './output/Abstellanlagen_Fuerth'
	// });

	await shapeToGeojson({
		inputFileName: '../data/Radverkehr/Radverkehr_Fuerth',
		outputFileName: './output/Radverkehr_Fuerth',
		typesDefinitions: TYPE_DEFINITIONS
	});
})();
