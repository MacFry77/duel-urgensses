const assert=require('node:assert/strict');
const {resolve}=require('../server');
const room={leadColor:'gray',played:[{player:0,die:{color:'gray',face:4}},{player:1,die:{color:'red',face:6}}]};
assert.equal(resolve(room),1,'Le 6 rouge doit battre le 4 gris malgré la couleur demandée grise.');
room.played=[{player:0,die:{color:'red',face:6}},{player:1,die:{color:'gray',face:6}}];
assert.equal(resolve(room),1,'En cas d’égalité numérique, le dernier dé joué doit gagner.');
console.log('Test des valeurs numériques réussi : plus haute valeur toutes couleurs confondues.');
