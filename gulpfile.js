'use strict';

const gulp = require('gulp');
const log = require('fancy-log');
const chalk = require('chalk');
const ejs = require('gulp-ejs');
const zip = require('gulp-zip');
const mergeStream = require('merge-stream');
const {
	formatVersionFolder,
	compareStrings,
	formatPackageUpgrades,
	getLibraries,
	getUpgradeVersions,
} = require('./utility');

const libraries = getLibraries();

function makePackageTask(library) {
	const packageFn = function() {
		const resourceZipStream =
			library.manifest.resources && library.manifest.resources.length
				? gulp
						.src(library.manifest.resources)
						.pipe(zip('Resources.zip'))
				: null;

		const templateData = {
			version: library.version,
			versionFolder: formatVersionFolder(library.version),
		};
		const filesStream = gulp
			.src(['LICENSE.htm', 'CHANGES.htm', '*.dnn'], {
				cwd: library.path,
			})
			.pipe(ejs(templateData, { delimiter: '~' }))
			.pipe(gulp.src(library.manifest.files));

		const packageStream = resourceZipStream
			? mergeStream(filesStream, resourceZipStream)
			: filesStream;

		return packageStream
			.pipe(zip(`${library.name}_${library.version}.zip`))
			.pipe(gulp.dest('./_InstallPackages/'));
	};

	packageFn.displayName = `Generate ${library.name}_${library.version}.zip`;
	return packageFn;
}

const defaultTask = gulp.parallel(...libraries.map(makePackageTask));

function outdated() {
	const allUpgradesPromises = libraries.map(library =>
		getUpgradeVersions(library).then(upgrades =>
			Object.assign(library, { upgrades })
		)
	);

	return Promise.all(allUpgradesPromises).then(allUpgrades => {
		const validUpgrades = allUpgrades
			.filter(({ upgrades }) => upgrades.size > 0)
			.sort(({ name: a }, { name: b }) => compareStrings(a, b));

		if (validUpgrades.length === 0) {
			log.warn(
				chalk`All {yellow ${allUpgrades.length}} packages up-to-date`
			);

			return;
		}

		log.info(`
${formatPackageUpgrades(validUpgrades)}`);
	});
}

function makeUpgradeTask(upgradeType) {
	const upgradeFn = function() {
		const allUpgradesPromises = libraries.map(library =>
			getUpgradeVersions(library).then(upgrades =>
				Object.assign(library, { upgrades })
			)
		);

		return Promise.all(allUpgradesPromises).then(allUpgrades => {
			const validUpgrades = allUpgrades.filter(({ upgrades }) =>
				upgrades.get(upgradeType)
			);

			if (validUpgrades.length === 0) {
				log.warn(`No ${upgradeType} upgrades to process`);

				return;
			}

			const upgradeWarnings = validUpgrades.map(
				({ name, version, upgrades, manifest }) => {
					const newVersion = upgrades.get(upgradeType);
					log(
						chalk`Upgrading {magenta ${name}} from {yellow ${version}} to {yellow ${newVersion}}`
					);

					const spawn = require('cross-spawn');
					spawn.sync(
						'yarn',
						[
							'upgrade',
							'--exact',
							'--non-interactive',
							`${name}@${newVersion}`,
						],
						{
							stdio: 'inherit',
						}
					);
					spawn.sync(
						'git',
						[
							'commit',
							'--all',
							'--message',
							`Upgrade ${name} to ${newVersion} (from ${version})`,
						],
						{ stdio: 'inherit' }
					);
					spawn.sync(
						'git',
						[
							'tag',
							'--sign',
							'--message',
							`Automatic ${upgradeType} upgrade of ${name} to ${newVersion} (from ${version})`,
							`${name}_${newVersion}`,
						],
						{ stdio: 'inherit' }
					);

					const fileGlobs = manifest.files.concat(
						manifest.resources || []
					);
					const hasExtraFiles = fileGlobs.some(
						f => f[0] !== '!' && !f.startsWith('node_modules')
					);

					return hasExtraFiles ? name : null;
				}
			);

			upgradeWarnings
				.filter(libraryName => libraryName !== null)
				.forEach(libraryName =>
					log.warn(
						chalk`The library {magenta ${libraryName}} has some resources that do not come from {gray node_modules}, please verify that the upgrade was complete`
					)
				);
		});
	};

	upgradeFn.displayName = `Apply ${upgradeType} upgrades`;

	return upgradeFn;
}

const upgradePatch = makeUpgradeTask('patch');
const upgradeMinor = makeUpgradeTask('minor');
const upgradeMajor = makeUpgradeTask('major');
const upgrade = gulp.series(upgradePatch, upgradeMinor, upgradeMajor);

module.exports = {
	outdated,
	upgradePatch,
	upgradeMinor,
	upgradeMajor,
	upgrade,
	default: defaultTask,
};
